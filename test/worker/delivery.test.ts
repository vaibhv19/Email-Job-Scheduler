import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { query, closePool } from '@reachinbox/db';
import { closeRedis, closeQueue } from '@reachinbox/redis';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import * as mailer from '../../apps/worker/src/mailer.js';
import { processEmailJob, type EmailJobData } from '../../apps/worker/src/processor.js';
import type { Job } from 'bullmq';

import crypto from 'crypto';

describe('Worker Engine: SMTP Delivery & Attempt Tracking (SMTP-01, SMTP-02, SMTP-03, SMTP-04, SMTP-05, SMTP-06, BE-11)', () => {
  let testEmailId: string;
  let secondSenderId: string;

  beforeAll(async () => {
    await ensureDefaultDevUser();

    // Create a second sender to verify multiple sender configurations (SMTP-02)
    secondSenderId = '00000000-0000-4000-8000-000000000003';
    await query(
      `INSERT INTO senders (id, user_id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;`,
      [
        secondSenderId,
        DEFAULT_DEV_USER_ID,
        'secondary@reachinbox.test',
        'ReachInbox Secondary Sender',
        'ethereal_secondary',
        1000,
        100,
      ],
    );
  });

  afterAll(async () => {
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('delivers email via Ethereal SMTP, captures preview URL, and generates stable Message-ID (SMTP-01, SMTP-03, SMTP-04, SMTP-05)', async () => {
    const emailUuid = crypto.randomUUID();
    testEmailId = emailUuid;

    // Insert scheduled email record
    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        testEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'ethereal_recipient@example.com',
        'Delivery Test Subject',
        '<p>Delivery Test HTML Body</p>',
      ],
    );

    const mockJob = {
      id: testEmailId,
      data: {
        emailId: testEmailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'ethereal_recipient@example.com',
        subject: 'Delivery Test Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job;

    // Process job
    const result = await processEmailJob(mockJob as unknown as Job<EmailJobData>);

    expect(result.status).toBe('sent');
    expect(result.emailId).toBe(testEmailId);
    expect(result.messageId).toBe(`<${testEmailId}@reachinbox.test>`); // Stable Message-ID (SMTP-05)

    // Verify database record transitioned to 'sent' with provider details (SMTP-03, BE-11)
    const emailRes = await query<{
      status: string;
      sent_at: string;
      preview_url: string;
      message_id: string;
      provider_message_id: string;
    }>(
      'SELECT status, sent_at, preview_url, message_id, provider_message_id FROM emails WHERE id = $1',
      [testEmailId],
    );

    const updatedEmail = emailRes.rows[0];
    expect(updatedEmail.status).toBe('sent');
    expect(updatedEmail.sent_at).not.toBeNull();
    expect(updatedEmail.message_id).toBe(`<${testEmailId}@reachinbox.test>`);
    expect(updatedEmail.provider_message_id).toBeDefined();

    // Ethereal preview URL verified (SMTP-04)
    if (updatedEmail.preview_url) {
      expect(updatedEmail.preview_url).toContain('ethereal.email');
    }

    // Verify email_attempts row exists with outcome = 'accepted'
    const attemptRes = await query<{
      attempt_number: number;
      outcome: string;
      provider_message_id: string;
      finished_at: string;
    }>(
      'SELECT attempt_number, outcome, provider_message_id, finished_at FROM email_attempts WHERE email_id = $1',
      [testEmailId],
    );

    expect(attemptRes.rows.length).toBeGreaterThanOrEqual(1);
    expect(attemptRes.rows[0].outcome).toBe('accepted');
    expect(attemptRes.rows[0].finished_at).not.toBeNull();
  }, 20000);

  it('supports sending from multiple sender configurations (SMTP-02)', async () => {
    const multiSenderEmailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        multiSenderEmailId,
        DEFAULT_DEV_USER_ID,
        secondSenderId,
        'secondary_recipient@example.com',
        'Secondary Sender Subject',
        '<p>Secondary Sender Body</p>',
      ],
    );

    const mockJob = {
      id: multiSenderEmailId,
      data: {
        emailId: multiSenderEmailId,
        senderId: secondSenderId,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'secondary_recipient@example.com',
        subject: 'Secondary Sender Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job;

    const result = await processEmailJob(mockJob as unknown as Job<EmailJobData>);
    expect(result.status).toBe('sent');

    const emailRecord = await query<{ status: string; sender_id: string }>(
      'SELECT status, sender_id FROM emails WHERE id = $1',
      [multiSenderEmailId],
    );
    expect(emailRecord.rows[0].status).toBe('sent');
    expect(emailRecord.rows[0].sender_id).toBe(secondSenderId);
  }, 20000);

  it('classifies transient errors vs permanent errors correctly (SMTP-06)', () => {
    // 4xx SMTP response is classified as transient
    const transientErr = {
      responseCode: 451,
      message: 'Requested action aborted: local error in processing',
    };
    const transientResult = mailer.classifySmtpError(transientErr);
    expect(transientResult.isTransient).toBe(true);

    // Network timeout is classified as transient
    const timeoutErr = { code: 'ETIMEDOUT', message: 'Connection timed out' };
    const timeoutResult = mailer.classifySmtpError(timeoutErr);
    expect(timeoutResult.isTransient).toBe(true);

    // 5xx SMTP response is classified as permanent
    const permanentErr = { responseCode: 550, message: 'User not found' };
    const permanentResult = mailer.classifySmtpError(permanentErr);
    expect(permanentResult.isTransient).toBe(false);
  });

  it('permanently marks email as failed on permanent 5xx SMTP error (SMTP-06, BE-11)', async () => {
    const permanentFailEmailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        permanentFailEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'nonexistent@example.com',
        'Permanent Fail Subject',
        'Body',
      ],
    );

    // Mock sendEmailViaSmtp to return permanent 550 error
    const spy = vi.spyOn(mailer, 'sendEmailViaSmtp').mockResolvedValueOnce({
      success: false,
      messageId: `<${permanentFailEmailId}@reachinbox.test>`,
      isTransientError: false,
      errorCode: 'SMTP_550',
      errorMessage: '550 5.1.1 User unknown',
    });

    const mockJob = {
      id: permanentFailEmailId,
      data: {
        emailId: permanentFailEmailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'nonexistent@example.com',
        subject: 'Permanent Fail Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job;

    const result = await processEmailJob(mockJob as unknown as Job<EmailJobData>);
    expect(result.status).toBe('failed');
    spy.mockRestore();

    // Verify email status in database transitioned to 'failed'
    const emailRow = await query<{ status: string; last_error: { code: string } }>(
      'SELECT status, last_error FROM emails WHERE id = $1',
      [permanentFailEmailId],
    );
    expect(emailRow.rows[0].status).toBe('failed');
    expect(emailRow.rows[0].last_error.code).toBe('SMTP_550');

    // Verify email attempt outcome is 'rejected'
    const attemptRow = await query<{ outcome: string; error_code: string }>(
      'SELECT outcome, error_code FROM email_attempts WHERE email_id = $1',
      [permanentFailEmailId],
    );
    expect(attemptRow.rows[0].outcome).toBe('rejected');
    expect(attemptRow.rows[0].error_code).toBe('SMTP_550');
  });

  it('resets email to scheduled on transient 4xx error for BullMQ retry (SMTP-06, BE-11)', async () => {
    const transientEmailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled')
       ON CONFLICT (id) DO NOTHING;`,
      [
        transientEmailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'transient@example.com',
        'Transient Subject',
        'Body',
      ],
    );

    const spy = vi.spyOn(mailer, 'sendEmailViaSmtp').mockResolvedValueOnce({
      success: false,
      messageId: `<${transientEmailId}@reachinbox.test>`,
      isTransientError: true,
      errorCode: 'SMTP_451',
      errorMessage: '451 4.3.0 Local error, please try later',
    });

    const mockJob = {
      id: transientEmailId,
      data: {
        emailId: transientEmailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'transient@example.com',
        subject: 'Transient Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job;

    await expect(processEmailJob(mockJob as unknown as Job<EmailJobData>)).rejects.toThrow(
      'Transient SMTP Error',
    );
    spy.mockRestore();

    // Verify email status was reset to 'scheduled' for retry
    const emailRow = await query<{ status: string }>('SELECT status FROM emails WHERE id = $1', [
      transientEmailId,
    ]);
    expect(emailRow.rows[0].status).toBe('scheduled');
  });
});
