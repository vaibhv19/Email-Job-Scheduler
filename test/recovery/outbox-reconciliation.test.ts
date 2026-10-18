import { describe, it, expect, afterAll } from 'vitest';
import { query, closePool } from '@email-scheduler/db';
import { getEmailQueue, closeQueue, closeRedis } from '@email-scheduler/redis';
import { reconcilePendingOutbox } from '../../apps/api/src/services/reconciliation.js';
import {
  DEFAULT_DEV_SENDER_ID,
  DEFAULT_DEV_USER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';

describe('Database-to-Queue Partial Failure Recovery & Outbox Reconciliation (BE-10)', () => {
  afterAll(async () => {
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('recovers un-enqueued emails from scheduling outbox into BullMQ delayed queue (BE-10)', async () => {
    await ensureDefaultDevUser();

    // 1. Simulate partial failure: write email and outbox record with processed_at = NULL
    const futureDate = new Date(Date.now() + 2400000); // 40 minutes from now
    const testRecipient = `outbox_recovery_${Date.now()}@example.com`;

    const insertRes = await query<{ id: string }>(
      `INSERT INTO emails (
        user_id, sender_id, recipient_email, subject, body, scheduled_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
      RETURNING id;`,
      [
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        testRecipient,
        'Outbox Recovery Test',
        'Outbox Body',
        futureDate,
      ],
    );
    const emailId = insertRes.rows[0].id;

    // Insert outbox record with processed_at = NULL (simulating queue connection drop)
    await query(
      `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload, processed_at)
       VALUES ('EMAIL_SCHEDULED', $1, $2, NULL);`,
      [
        emailId,
        JSON.stringify({
          emailId,
          senderId: DEFAULT_DEV_SENDER_ID,
          userId: DEFAULT_DEV_USER_ID,
          recipientEmail: testRecipient,
          subject: 'Outbox Recovery Test',
          scheduledAt: futureDate.toISOString(),
        }),
      ],
    );

    // 2. Verify BullMQ queue does NOT have this job yet
    const queue = getEmailQueue();
    const jobBefore = await queue.getJob(emailId);
    expect(jobBefore).toBeUndefined();

    // 3. Run outbox reconciliation service
    const reconciliationResult = await reconcilePendingOutbox();
    expect(reconciliationResult.inspected).toBeGreaterThanOrEqual(1);
    expect(reconciliationResult.recovered).toBeGreaterThanOrEqual(1);

    // 4. Verify BullMQ delayed job NOW exists with deterministic jobId = emailId
    const jobAfter = await queue.getJob(emailId);
    expect(jobAfter).toBeDefined();
    expect(jobAfter?.id).toBe(emailId);
    expect(jobAfter?.data.recipientEmail).toBe(testRecipient);

    // 5. Verify database outbox record is marked processed
    const outboxCheck = await query<{ processed_at: string | null }>(
      'SELECT processed_at FROM scheduling_outbox WHERE aggregate_id = $1',
      [emailId],
    );
    expect(outboxCheck.rows[0].processed_at).not.toBeNull();

    // 6. Running reconciliation again is idempotent and processes zero additional jobs
    const secondRun = await reconcilePendingOutbox();
    expect(secondRun.recovered).toBe(0);
  });
});
