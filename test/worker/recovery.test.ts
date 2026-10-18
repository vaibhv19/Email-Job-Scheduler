import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, closePool } from '@email-scheduler/db';
import { closeRedis, closeQueue, enqueueEmailJob } from '@email-scheduler/redis';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import { runStartupReconciliation } from '../../apps/worker/src/reconciler.js';

import crypto from 'crypto';

describe('Worker Recovery & Delayed Scheduling Accuracy (BE-09, BE-13, QA-03, QA-06)', () => {
  beforeAll(async () => {
    await ensureDefaultDevUser();
  });

  afterAll(async () => {
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('calculates delayed scheduling accurately without timing drift (QA-03)', async () => {
    const delayEmailId = crypto.randomUUID();
    const futureOffsetMs = 30000; // 30 seconds
    const targetScheduledAt = new Date(Date.now() + futureOffsetMs);

    const enqueueResult = await enqueueEmailJob({
      emailId: delayEmailId,
      senderId: DEFAULT_DEV_SENDER_ID,
      userId: DEFAULT_DEV_USER_ID,
      recipientEmail: 'delayed@example.com',
      subject: 'Delayed Test',
      scheduledAt: targetScheduledAt,
    });

    expect(enqueueResult.jobId).toBe(delayEmailId);
    // Calculated delay must be within 1000ms of requested futureOffsetMs
    expect(enqueueResult.delay).toBeGreaterThanOrEqual(futureOffsetMs - 1000);
    expect(enqueueResult.delay).toBeLessThanOrEqual(futureOffsetMs + 1000);
  });

  it('startup reconciliation recovers unprocessed outbox records into BullMQ (BE-09, QA-06)', async () => {
    const outboxEmailId = crypto.randomUUID();
    const scheduledDate = new Date(Date.now() + 10000);

    // 1. Insert email in PostgreSQL
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        outboxEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'stranded@example.com',
        'Stranded Outbox Subject',
        '<p>Stranded Body</p>',
        scheduledDate,
      ],
    );

    // 2. Insert unprocessed outbox row
    await query(
      `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload, processed_at)
       VALUES ('EMAIL_SCHEDULED', $1, $2, NULL);`,
      [
        outboxEmailId,
        JSON.stringify({
          emailId: outboxEmailId,
          senderId: DEFAULT_DEV_SENDER_ID,
          userId: DEFAULT_DEV_USER_ID,
          recipientEmail: 'stranded@example.com',
          subject: 'Stranded Outbox Subject',
          scheduledAt: scheduledDate.toISOString(),
        }),
      ],
    );

    // 3. Run startup reconciliation
    const summary = await runStartupReconciliation();
    expect(summary.recoveredOutbox).toBeGreaterThanOrEqual(1);

    // 4. Verify outbox row is now marked processed
    const outboxRow = await query<{ processed_at: string }>(
      'SELECT processed_at FROM scheduling_outbox WHERE aggregate_id = $1',
      [outboxEmailId],
    );
    expect(outboxRow.rows[0].processed_at).not.toBeNull();
  });

  it('recovers crashed worker jobs stuck in processing state (BE-13, QA-06)', async () => {
    const crashedEmailId = crypto.randomUUID();

    // Simulate an email stuck in 'processing' from a worker crash 10 minutes ago
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'processing', NOW() - INTERVAL '10 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() - INTERVAL '10 minutes';`,
      [
        crashedEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'crashed@example.com',
        'Crashed Worker Subject',
        '<p>Crashed Body</p>',
      ],
    );

    // Run reconciliation
    const summary = await runStartupReconciliation();
    expect(summary.recoveredStaleProcessing).toBeGreaterThanOrEqual(1);

    // Assert email was safely reverted to 'scheduled' for reprocessing
    const emailRow = await query<{ status: string }>('SELECT status FROM emails WHERE id = $1', [
      crashedEmailId,
    ]);
    expect(emailRow.rows[0].status).toBe('scheduled');
  });
});
