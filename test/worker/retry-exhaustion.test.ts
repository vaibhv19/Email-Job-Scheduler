import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { query, closePool } from '@reachinbox/db';
import {
  closeRedis,
  closeQueue,
  enqueueEmailJob,
  getEmailQueue,
  DEFAULT_JOB_ATTEMPTS,
} from '@reachinbox/redis';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import { processEmailJob, type EmailJobData } from '../../apps/worker/src/processor.js';
import * as mailer from '../../apps/worker/src/mailer.js';
import type { Job } from 'bullmq';

import crypto from 'crypto';

describe('Retry Exhaustion & Terminal Failure Handling (RATE-01, SMTP-06, BE-11)', () => {
  beforeAll(async () => {
    await ensureDefaultDevUser();
  });

  afterAll(async () => {
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('configures explicit BullMQ attempts and exponential backoff on delayed jobs', async () => {
    const emailId = crypto.randomUUID();

    const enqueueResult = await enqueueEmailJob({
      emailId,
      senderId: DEFAULT_DEV_SENDER_ID,
      userId: DEFAULT_DEV_USER_ID,
      recipientEmail: 'retry_opts@example.com',
      subject: 'Retry Opts Subject',
      scheduledAt: new Date(Date.now() + 10000),
    });

    const queue = getEmailQueue();
    const job = await queue.getJob(enqueueResult.jobId);
    expect(job).not.toBeNull();
    expect(job!.opts.attempts).toBe(DEFAULT_JOB_ATTEMPTS);
    expect(job!.opts.backoff).toEqual({
      type: 'exponential',
      delay: 2000,
    });
  });

  it('resets email to scheduled for BullMQ retry when transient error occurs and retries remain', async () => {
    const emailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled');`,
      [
        emailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'retry_transient@example.com',
        'Transient Subject',
        'Body',
      ],
    );

    const spy = vi.spyOn(mailer, 'sendEmailViaSmtp').mockResolvedValueOnce({
      success: false,
      messageId: `<${emailId}@reachinbox.test>`,
      isTransientError: true,
      errorCode: 'SMTP_451',
      errorMessage: '451 4.3.0 Greylisting temporary error',
    });

    // Attempt 1 of 3 (attemptsMade = 0)
    const mockJob = {
      id: emailId,
      attemptsMade: 0,
      opts: { attempts: 3 },
      data: {
        emailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'retry_transient@example.com',
        subject: 'Transient Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job<EmailJobData>;

    await expect(processEmailJob(mockJob)).rejects.toThrow('Transient SMTP Error');
    spy.mockRestore();

    // Verify email status was reset to 'scheduled' for BullMQ backoff retry
    const emailRow = await query<{
      status: string;
      last_error: { code: string; transient: boolean };
    }>('SELECT status, last_error FROM emails WHERE id = $1', [emailId]);
    expect(emailRow.rows[0].status).toBe('scheduled');
    expect(emailRow.rows[0].last_error.code).toBe('SMTP_451');
    expect(emailRow.rows[0].last_error.transient).toBe(true);

    // Verify attempt 1 was recorded as rejected
    const attemptRow = await query<{ outcome: string; error_code: string }>(
      'SELECT outcome, error_code FROM email_attempts WHERE email_id = $1 AND attempt_number = 1',
      [emailId],
    );
    expect(attemptRow.rows[0].outcome).toBe('rejected');
    expect(attemptRow.rows[0].error_code).toBe('SMTP_451');
  });

  it('transitions email to failed when final retry attempt is exhausted (terminal failure)', async () => {
    const emailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled');`,
      [
        emailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'retry_exhaust@example.com',
        'Exhaust Subject',
        'Body',
      ],
    );

    const spy = vi.spyOn(mailer, 'sendEmailViaSmtp').mockResolvedValueOnce({
      success: false,
      messageId: `<${emailId}@reachinbox.test>`,
      isTransientError: true,
      errorCode: 'SMTP_451',
      errorMessage: '451 4.3.0 Greylisting timeout, final attempt failed',
    });

    // Attempt 3 of 3 (attemptsMade = 2) -> isFinalAttempt = true
    const mockJob = {
      id: emailId,
      attemptsMade: 2,
      opts: { attempts: 3 },
      data: {
        emailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'retry_exhaust@example.com',
        subject: 'Exhaust Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job<EmailJobData>;

    await expect(processEmailJob(mockJob)).rejects.toThrow('Retry Exhausted');
    spy.mockRestore();

    // Verify email status transitioned to 'failed' (NOT left stranded in 'scheduled')
    const emailRow = await query<{
      status: string;
      last_error: { code: string; attemptsMade: number; lastErrorCode: string };
    }>('SELECT status, last_error FROM emails WHERE id = $1', [emailId]);

    expect(emailRow.rows[0].status).toBe('failed');
    expect(emailRow.rows[0].last_error.code).toBe('RETRY_EXHAUSTED');
    expect(emailRow.rows[0].last_error.attemptsMade).toBe(3);
    expect(emailRow.rows[0].last_error.lastErrorCode).toBe('SMTP_451');
  });

  it('distinguishes permanent 5xx failures and transitions immediately to failed on first attempt', async () => {
    const emailId = crypto.randomUUID();

    await query(
      `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'scheduled');`,
      [
        emailId,
        DEFAULT_DEV_USER_ID,
        DEFAULT_DEV_SENDER_ID,
        'perm_fail@example.com',
        'Perm Subject',
        'Body',
      ],
    );

    const spy = vi.spyOn(mailer, 'sendEmailViaSmtp').mockResolvedValueOnce({
      success: false,
      messageId: `<${emailId}@reachinbox.test>`,
      isTransientError: false,
      errorCode: 'SMTP_550',
      errorMessage: '550 5.1.1 User unknown',
    });

    // Attempt 1 of 3
    const mockJob = {
      id: emailId,
      attemptsMade: 0,
      opts: { attempts: 3 },
      data: {
        emailId,
        senderId: DEFAULT_DEV_SENDER_ID,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: 'perm_fail@example.com',
        subject: 'Perm Subject',
        scheduledAt: new Date().toISOString(),
      },
    } as unknown as Job<EmailJobData>;

    const result = await processEmailJob(mockJob);
    expect(result.status).toBe('failed');
    spy.mockRestore();

    // Immediately transitioned to failed without throwing for retry
    const emailRow = await query<{
      status: string;
      last_error: { code: string; transient: boolean };
    }>('SELECT status, last_error FROM emails WHERE id = $1', [emailId]);
    expect(emailRow.rows[0].status).toBe('failed');
    expect(emailRow.rows[0].last_error.code).toBe('SMTP_550');
    expect(emailRow.rows[0].last_error.transient).toBe(false);
  });
});
