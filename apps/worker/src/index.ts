import dotenv from 'dotenv';
import path from 'path';
import { checkDatabaseHealth, closePool, query } from '@reachinbox/db';
import {
  checkRedisHealth,
  closeRedis,
  createEmailWorker,
  DEFAULT_JOB_ATTEMPTS,
  type Worker,
} from '@reachinbox/redis';
import { RATE_LIMIT_DEFAULTS } from '@reachinbox/shared';
import { processEmailJob } from './processor.js';
import { runStartupReconciliation } from './reconciler.js';

import fs from 'fs';

// Load environment from workspace root or current directory
function loadEnv() {
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.resolve(curr, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  dotenv.config();
}
loadEnv();

const concurrency = process.env.WORKER_CONCURRENCY
  ? parseInt(process.env.WORKER_CONCURRENCY, 10)
  : RATE_LIMIT_DEFAULTS.WORKER_CONCURRENCY;

const minSendIntervalMs = process.env.DEFAULT_MIN_SEND_INTERVAL_MS
  ? parseInt(process.env.DEFAULT_MIN_SEND_INTERVAL_MS, 10)
  : RATE_LIMIT_DEFAULTS.MIN_SEND_INTERVAL_MS;

const maxEmailsPerHour = process.env.DEFAULT_MAX_EMAILS_PER_HOUR
  ? parseInt(process.env.DEFAULT_MAX_EMAILS_PER_HOUR, 10)
  : RATE_LIMIT_DEFAULTS.MAX_EMAILS_PER_HOUR;

console.log('[Worker] Initializing independent background worker process...');
console.log(`[Worker] Concurrency limit: ${concurrency} simultaneous jobs`);
console.log(`[Worker] Default sender delay: ${minSendIntervalMs}ms`);
console.log(`[Worker] Default hourly quota: ${maxEmailsPerHour} emails/hr`);

let isRunning = true;
let emailWorker: Worker | null = null;
let reconciliationInterval: NodeJS.Timeout | null = null;

async function bootstrap() {
  const [dbHealthy, redisHealthy] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

  if (!dbHealthy) {
    console.error('[Worker] Fatal: PostgreSQL is not reachable at startup.');
    process.exit(1);
  }
  console.log('[Worker] Connected to PostgreSQL successfully.');

  if (!redisHealthy) {
    console.error('[Worker] Fatal: Redis is not reachable at startup.');
    process.exit(1);
  }
  console.log('[Worker] Connected to Redis successfully.');

  // 1. Run startup outbox and crash recovery (BE-09, QA-06)
  try {
    await runStartupReconciliation();
  } catch (recErr) {
    console.error('[Worker] Error during startup reconciliation:', recErr);
  }

  // 2. Initialize BullMQ Worker process with configured concurrency (RATE-01, BE-11)
  emailWorker = createEmailWorker(processEmailJob, { concurrency });

  emailWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully.`);
  });

  emailWorker.on('failed', async (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    if (job?.data?.emailId) {
      const maxAttempts = job.opts?.attempts || DEFAULT_JOB_ATTEMPTS;
      if (job.attemptsMade >= maxAttempts) {
        try {
          const exhaustionJson = JSON.stringify({
            code: 'RETRY_EXHAUSTED',
            message: `Terminal failure after ${job.attemptsMade} attempts: ${err.message}`,
            transient: true,
          });
          await query(
            `UPDATE emails
             SET status = 'failed', last_error = $1, updated_at = NOW()
             WHERE id = $2 AND status = 'scheduled'`,
            [exhaustionJson, job.data.emailId],
          );
        } catch (dbErr) {
          console.error(
            `[Worker] Failed to record terminal failure fallback for email ${job.data.emailId}:`,
            dbErr,
          );
        }
      }
    }
  });

  emailWorker.on('error', (err) => {
    console.error('[Worker] BullMQ worker error:', err);
  });

  console.log(`[Worker] BullMQ email worker started with concurrency = ${concurrency}.`);

  // 3. Periodic background outbox reconciliation (BE-10)
  reconciliationInterval = setInterval(async () => {
    if (!isRunning) return;
    try {
      await runStartupReconciliation();
    } catch (err) {
      console.warn('[Worker] Periodic reconciliation error:', err);
    }
  }, 30000);
}

const handleShutdown = async (signal: string) => {
  if (!isRunning) return;
  isRunning = false;
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }

  try {
    if (emailWorker) {
      console.log('[Worker] Closing BullMQ worker...');
      await emailWorker.close();
      emailWorker = null;
    }
    await closePool();
    await closeRedis();
    console.log('[Worker] Database and Redis connections closed cleanly.');
  } catch (err) {
    console.error('[Worker] Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

bootstrap().catch((err) => {
  console.error('[Worker] Fatal error during startup:', err);
  process.exit(1);
});
