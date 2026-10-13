import dotenv from 'dotenv';
import path from 'path';
import { checkDatabaseHealth, closePool } from '@reachinbox/db';
import { checkRedisHealth, closeRedis } from '@reachinbox/redis';
import { RATE_LIMIT_DEFAULTS } from '@reachinbox/shared';

// Load environment from workspace root if not already set
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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

async function bootstrap() {
  const [dbHealthy, redisHealthy] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

  if (!dbHealthy) {
    console.warn('[Worker] Warning: PostgreSQL is not reachable at startup.');
  } else {
    console.log('[Worker] Connected to PostgreSQL successfully.');
  }

  if (!redisHealthy) {
    console.warn('[Worker] Warning: Redis is not reachable at startup.');
  } else {
    console.log('[Worker] Connected to Redis successfully.');
  }

  console.log('[Worker] Worker process is active and idling for job processors (Phase 4).');

  // Keep event loop active
  const heartbeat = setInterval(() => {
    if (!isRunning) {
      clearInterval(heartbeat);
    }
  }, 10000);
}

const handleShutdown = async (signal: string) => {
  if (!isRunning) return;
  isRunning = false;
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  try {
    await closePool();
    await closeRedis();
    console.log('[Worker] Database and Redis connections closed.');
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
