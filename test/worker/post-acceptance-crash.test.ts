import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query, closePool } from '@reachinbox/db';
import { closeRedis, closeQueue } from '@reachinbox/redis';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import { processEmailJob, type EmailJobData } from '../../apps/worker/src/processor.js';
import type { Job } from 'bullmq';

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

  it('reconciles email to sent without duplicate SMTP send when previous attempt was accepted (QA-18, SMTP-08)', async () => {
    const postCrashEmailId = crypto.randomUUID();
    const fakeProviderMessageId = '<mock-250-accepted-message-id@ethereal.test>';

    // 1. Simulate an email left in 'processing' status
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'processing')
       ON CONFLICT (id) DO UPDATE SET status = 'processing';`,
      [
        postCrashEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'crash_recovery@example.com',
        'Post Crash Subject',
        '<p>Post Crash Body</p>',
      ],
    );

    // 2. Simulate attempt 1 was accepted by SMTP provider right before the worker crashed
    await query(
      `INSERT INTO email_attempts (email_id, attempt_number, outcome, provider_message_id, finished_at)
       VALUES ($1, 1, 'accepted', $2, NOW());`,
      [postCrashEmailId, fakeProviderMessageId],
    );

    const mockJob = {
      id: postCrashEmailId,
      data: {
        emailId: postCrashEmailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'crash_recovery@example.com',
        subject: 'Post Crash Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job;

    // 3. Worker recovers and processes the job again
    const typedJob = mockJob as unknown as Job<EmailJobData>;
    const result = await processEmailJob(typedJob);

    // Assert that the job recognized the previous acceptance and reconciled to 'sent'
    expect(result.status).toBe('sent');
    expect(result.messageId).toBe(fakeProviderMessageId);

    // 4. Verify that NO second attempt was made (no blind resend)
    const attempts = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM email_attempts WHERE email_id = $1',
      [postCrashEmailId],
    );
    expect(parseInt(attempts.rows[0].count, 10)).toBe(1);

    // 5. Verify email table reflects status = 'sent' with provider message ID
    const emailRow = await query<{ status: string; provider_message_id: string }>(
      'SELECT status, provider_message_id FROM emails WHERE id = $1',
      [postCrashEmailId],
    );
    expect(emailRow.rows[0].status).toBe('sent');
    expect(emailRow.rows[0].provider_message_id).toBe(fakeProviderMessageId);
  });
});
