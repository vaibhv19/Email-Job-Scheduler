import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, closePool } from '@email-scheduler/db';
import { closeRedis, closeQueue, enqueueEmailJob, getEmailQueue } from '@email-scheduler/redis';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import { runStartupReconciliation } from '../../apps/worker/src/reconciler.js';

import crypto from 'crypto';

describe('Post-SMTP Acceptance Crash Scenario & Conservative Recovery (SMTP-08, SMTP-09, QA-18)', () => {
  beforeAll(async () => {
    await ensureDefaultDevUser();
  });

  afterAll(async () => {
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('marks email failed with ambiguous error when worker crashed while attempt was in_progress (SMTP-08, QA-18)', async () => {
    const postCrashEmailId = crypto.randomUUID();

    // 1. Simulate an email left in 'processing' status from a crash 6 minutes ago
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'processing', NOW() - INTERVAL '6 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() - INTERVAL '6 minutes';`,
      [
        postCrashEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'crash_recovery@example.com',
        'Post Crash Subject',
        '<p>Post Crash Body</p>',
      ],
    );

    // 2. Realistic crash boundary: Worker started attempt 1, but crashed before persisting final acceptance outcome
    // The attempt remains 'in_progress' in PostgreSQL with no provider_message_id
    await query(
      `INSERT INTO email_attempts (email_id, attempt_number, outcome, started_at)
       VALUES ($1, 1, 'in_progress', NOW() - INTERVAL '6 minutes');`,
      [postCrashEmailId],
    );

    // 3. Run reconciliation
    const summary = await runStartupReconciliation();
    expect(summary.ambiguousCrashesHandled).toBeGreaterThanOrEqual(1);

    // 4. Verify email attempt outcome was updated to 'unknown' (ambiguous state)
    const attemptRow = await query<{ outcome: string; error_code: string }>(
      'SELECT outcome, error_code FROM email_attempts WHERE email_id = $1 AND attempt_number = 1',
      [postCrashEmailId],
    );
    expect(attemptRow.rows[0].outcome).toBe('unknown');
    expect(attemptRow.rows[0].error_code).toBe('AMBIGUOUS_CRASH_OUTCOME');

    // 5. Verify email status transitioned to 'failed' (non-retryable manual-review) to prevent duplicate send
    const emailRow = await query<{
      status: string;
      last_error: { code: string; requiresManualReview: boolean };
    }>('SELECT status, last_error FROM emails WHERE id = $1', [postCrashEmailId]);
    expect(emailRow.rows[0].status).toBe('failed');
    expect(emailRow.rows[0].last_error.code).toBe('AMBIGUOUS_CRASH_OUTCOME');
    expect(emailRow.rows[0].last_error.requiresManualReview).toBe(true);

    // 6. Verify NO duplicate attempt was made
    const attempts = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM email_attempts WHERE email_id = $1',
      [postCrashEmailId],
    );
    expect(parseInt(attempts.rows[0].count, 10)).toBe(1);
  });

  it('safely re-enqueues stale processing email when worker crashed before initiating any SMTP attempt (BE-13, QA-06)', async () => {
    const preAttemptCrashEmailId = crypto.randomUUID();

    // 1. Worker claimed the email 6 minutes ago, but crashed before inserting into email_attempts
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'processing', NOW() - INTERVAL '6 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() - INTERVAL '6 minutes';`,
      [
        preAttemptCrashEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'preattempt_crash@example.com',
        'Pre-attempt Crash Subject',
        '<p>Body</p>',
      ],
    );

    // 2. Run reconciliation (zero attempts exist for this email)
    const summary = await runStartupReconciliation();
    expect(summary.recoveredStaleProcessing).toBeGreaterThanOrEqual(1);

    // 3. Since no attempt was ever initiated, it is provably safe to revert to 'scheduled' and re-enqueue
    const emailRow = await query<{ status: string }>('SELECT status FROM emails WHERE id = $1', [
      preAttemptCrashEmailId,
    ]);
    expect(emailRow.rows[0].status).toBe('scheduled');
  });

  it('reconciles email to sent without duplicate send when previous attempt was recorded as accepted (QA-18, SMTP-08)', async () => {
    const acceptedCrashEmailId = crypto.randomUUID();
    const fakeProviderMessageId = '<mock-250-accepted-message-id@ethereal.test>';

    // 1. Worker died after attempt was accepted
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'processing', NOW() - INTERVAL '6 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() - INTERVAL '6 minutes';`,
      [
        acceptedCrashEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'accepted_recovery@example.com',
        'Accepted Subject',
        '<p>Body</p>',
      ],
    );

    await query(
      `INSERT INTO email_attempts (email_id, attempt_number, outcome, provider_message_id, finished_at)
       VALUES ($1, 1, 'accepted', $2, NOW());`,
      [acceptedCrashEmailId, fakeProviderMessageId],
    );

    // 2. Reconcile
    const summary = await runStartupReconciliation();
    expect(summary.recoveredStaleProcessing).toBeGreaterThanOrEqual(1);

    // 3. Verify status is 'sent' with provider message ID
    const emailRow = await query<{ status: string; provider_message_id: string }>(
      'SELECT status, provider_message_id FROM emails WHERE id = $1',
      [acceptedCrashEmailId],
    );
    expect(emailRow.rows[0].status).toBe('sent');
    expect(emailRow.rows[0].provider_message_id).toBe(fakeProviderMessageId);

    // 4. Verify no new attempts were created
    const attempts = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM email_attempts WHERE email_id = $1',
      [acceptedCrashEmailId],
    );
    expect(parseInt(attempts.rows[0].count, 10)).toBe(1);
  });

  it('does not mutate or interrupt an actively running slow worker job during reconciliation', async () => {
    const activeEmailId = crypto.randomUUID();

    // 1. Insert email in 'processing' state older than 5 minutes
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'processing', NOW() - INTERVAL '6 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() - INTERVAL '6 minutes';`,
      [
        activeEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'slow_worker@example.com',
        'Slow Worker Subject',
        '<p>Body</p>',
      ],
    );

    // 2. Enqueue job into BullMQ
    await enqueueEmailJob({
      emailId: activeEmailId,
      senderId: DEFAULT_DEV_SENDER_ID,
      userId: DEFAULT_DEV_USER_ID,
      recipientEmail: 'slow_worker@example.com',
      subject: 'Slow Worker Subject',
      scheduledAt: new Date(),
    });

    // 3. Mock job.isActive() returning true to simulate an active running worker
    const queue = getEmailQueue();
    const realGetJob = queue.getJob.bind(queue);
    queue.getJob = async (jobId: string) => {
      const j = await realGetJob(jobId);
      if (j && j.id === activeEmailId) {
        j.isActive = async () => true;
      }
      return j;
    };

    try {
      // 4. Run reconciliation
      const summary = await runStartupReconciliation();
      expect(summary.skippedActiveProcessing).toBeGreaterThanOrEqual(1);

      // 5. Verify email status remains 'processing' untouched
      const emailRow = await query<{ status: string }>('SELECT status FROM emails WHERE id = $1', [
        activeEmailId,
      ]);
      expect(emailRow.rows[0].status).toBe('processing');
    } finally {
      queue.getJob = realGetJob;
    }
  });
});
