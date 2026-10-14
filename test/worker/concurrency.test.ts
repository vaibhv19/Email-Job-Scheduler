import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { query, closePool, getPool } from '@reachinbox/db';
import {
  closeRedis,
  closeQueue,
  createEmailWorker,
  getRedisClient,
  resetSenderRateLimits,
} from '@reachinbox/redis';
import { runStartupReconciliation } from '../../apps/worker/src/reconciler.js';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import {
  claimEmailForProcessing,
  processEmailJob,
  type EmailJobData,
} from '../../apps/worker/src/processor.js';
import type { Job } from 'bullmq';

import crypto from 'crypto';

describe('Worker Concurrency & Atomic Claiming (BE-12, QA-05, RATE-01)', () => {
  beforeAll(async () => {
    await ensureDefaultDevUser();
  });

  beforeEach(async () => {
    await resetSenderRateLimits(getRedisClient(), DEFAULT_DEV_SENDER_ID);
  });

  afterAll(async () => {
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('atomic claiming prevents multiple concurrent workers from claiming the same email (BE-12, QA-05)', async () => {
    const claimEmailId = crypto.randomUUID();

    // Insert scheduled email
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        claimEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'claim_test@example.com',
        'Atomic Claim Subject',
        '<p>Atomic Claim Body</p>',
      ],
    );

    // Simulate 3 concurrent workers attempting to claim the exact same email
    const [claimA, claimB, claimC] = await Promise.all([
      claimEmailForProcessing(claimEmailId),
      claimEmailForProcessing(claimEmailId),
      claimEmailForProcessing(claimEmailId),
    ]);

    // Exactly one worker must succeed in claiming the email
    const successfulClaims = [claimA, claimB, claimC].filter((c) => c !== null);
    const rejectedClaims = [claimA, claimB, claimC].filter((c) => c === null);

    expect(successfulClaims.length).toBe(1);
    expect(rejectedClaims.length).toBe(2);
    expect(successfulClaims[0]?.status).toBe('processing');

    // Confirm database status is now 'processing'
    const statusRes = await query<{ status: string }>('SELECT status FROM emails WHERE id = $1', [
      claimEmailId,
    ]);
    expect(statusRes.rows[0].status).toBe('processing');
  });

  it('competing worker job executions result in exactly one delivery and one skip (QA-05)', async () => {
    const raceEmailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        raceEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'race_test@example.com',
        'Race Delivery Subject',
        '<p>Race Delivery Body</p>',
      ],
    );

    const mockJob = {
      id: raceEmailId,
      data: {
        emailId: raceEmailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'race_test@example.com',
        subject: 'Race Delivery Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job;

    // Launch 2 parallel executions of the same job
    const typedJob = mockJob as unknown as Job<EmailJobData>;
    const [resultA, resultB] = await Promise.all([
      processEmailJob(typedJob),
      processEmailJob(typedJob),
    ]);

    const statuses = [resultA.status, resultB.status];
    expect(statuses).toContain('sent');
    expect(statuses).toContain('skipped');

    // Confirm only 1 attempt row was created
    const attempts = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM email_attempts WHERE email_id = $1',
      [raceEmailId],
    );
    expect(parseInt(attempts.rows[0].count, 10)).toBe(1);
  }, 20000);

  it('createEmailWorker honors configurable concurrency limits (RATE-01)', () => {
    const dummyProcessor = async () => {};
    const worker = createEmailWorker(dummyProcessor, { concurrency: 7 });

    expect(worker.opts.concurrency).toBe(7);
    worker.close();
  });

  it('reconciliation advisory lock enforces mutual exclusion across concurrent worker instances', async () => {
    const pool = getPool();
    const client = await pool.connect();
    let lockAcquired = false;

    try {
      // Simulate another worker process currently holding the reconciliation advisory lock
      const lockRes = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('reachinbox_reconciliation')) AS locked",
      );
      expect(lockRes.rows[0].locked).toBe(true);
      lockAcquired = true;

      // Now run reconciliation from our worker: it must detect the lock and skip execution cleanly
      const summary = await runStartupReconciliation({ maxLockRetries: 0 });
      expect(summary.lockSkipped).toBe(true);
      expect(summary.recoveredOutbox).toBe(0);
      expect(summary.recoveredStaleProcessing).toBe(0);
    } finally {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext('reachinbox_reconciliation'))");
      }
      client.release();
    }
  });
});
