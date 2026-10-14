import { query, withTransaction } from '@reachinbox/db';
import {
  type Job,
  DEFAULT_JOB_ATTEMPTS,
  getRedisClient,
  reserveRateLimitSlot,
  refundRateLimitQuota,
  DelayedError,
} from '@reachinbox/redis';
import { RATE_LIMIT_DEFAULTS } from '@reachinbox/shared';
import * as mailer from './mailer.js';

export interface EmailJobData {
  emailId: string;
  senderId: string;
  userId: string;
  recipientEmail: string;
  subject: string;
  scheduledAt: string;
}

export interface ClaimedEmail {
  id: string;
  user_id: string;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: string;
}

interface SenderRecord {
  id: string;
  email: string;
  display_name: string;
  smtp_config_ref: string;
  min_send_interval_ms?: number;
  max_emails_per_hour?: number;
}

/**
 * Atomically claims an email by transitioning its status from 'scheduled' to 'processing' (BE-12, QA-05)
 * Returns null if the email has already been claimed or is not in 'scheduled' state.
 */
export async function claimEmailForProcessing(emailId: string): Promise<ClaimedEmail | null> {
  const result = await query<ClaimedEmail>(
    `UPDATE emails
     SET status = 'processing', updated_at = NOW()
     WHERE id = $1 AND status = 'scheduled'
     RETURNING id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status;`,
    [emailId],
  );

  return result.rows[0] || null;
}

/**
 * Checks for ambiguous outcomes from previous attempts before resending (SMTP-08, QA-18)
 * If an attempt was previously accepted but a crash occurred before updating 'emails',
 * reconciles the email to 'sent' without sending a duplicate email.
 */
export async function checkPreviousAcceptedAttempt(
  emailId: string,
): Promise<{ alreadyAccepted: boolean; providerMessageId?: string } | null> {
  const attemptRes = await query<{ provider_message_id: string }>(
    `SELECT provider_message_id
     FROM email_attempts
     WHERE email_id = $1 AND outcome = 'accepted'
     ORDER BY finished_at DESC
     LIMIT 1;`,
    [emailId],
  );

  if (attemptRes.rows.length > 0) {
    const providerMessageId = attemptRes.rows[0].provider_message_id;
    // Reconcile status to sent to recover from post-acceptance crash
    await query(
      `UPDATE emails
       SET status = 'sent', sent_at = NOW(), provider_message_id = $1, updated_at = NOW()
       WHERE id = $2 AND status != 'sent'`,
      [providerMessageId, emailId],
    );
    return { alreadyAccepted: true, providerMessageId };
  }

  return null;
}

/**
 * Processes a single email delivery job received from BullMQ (BE-11, SMTP-01, SMTP-03, SMTP-06, RATE-02..RATE-21)
 */
export async function processEmailJob(
  job: Job<EmailJobData>,
  token?: string,
): Promise<{
  status: 'skipped' | 'sent' | 'failed' | 'retry_scheduled' | 'deferred';
  emailId: string;
  attemptId?: string;
  previewUrl?: string;
  messageId?: string;
}> {
  const { emailId } = job.data;

  // 1. Check for crash recovery: was this email already accepted in an earlier attempt? (QA-18)
  const recoveryCheck = await checkPreviousAcceptedAttempt(emailId);
  if (recoveryCheck?.alreadyAccepted) {
    console.log(
      `[Worker] Email ${emailId} was already accepted by provider in earlier attempt; reconciled to sent.`,
    );
    return { status: 'sent', emailId, messageId: recoveryCheck.providerMessageId };
  }

  // 2. Atomically claim the email in PostgreSQL (BE-12, QA-05)
  const email = await claimEmailForProcessing(emailId);
  if (!email) {
    console.log(
      `[Worker] Email ${emailId} could not be claimed (already processing, sent, or not found). Skipping job.`,
    );
    return { status: 'skipped', emailId };
  }

  // 3. Resolve sender details and rate limit configuration (RATE-06, RATE-07)
  const senderRes = await query<SenderRecord>(
    'SELECT id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour FROM senders WHERE id = $1',
    [email.sender_id],
  );

  if (senderRes.rows.length === 0) {
    const errorDetails = {
      code: 'SENDER_NOT_FOUND',
      message: `Sender ${email.sender_id} not found`,
    };
    await query(
      `UPDATE emails SET status = 'failed', last_error = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(errorDetails), email.id],
    );
    return { status: 'failed', emailId };
  }

  const sender = senderRes.rows[0];
  const minSendIntervalMs = sender.min_send_interval_ms ?? RATE_LIMIT_DEFAULTS.MIN_SEND_INTERVAL_MS;
  const maxEmailsPerHour = sender.max_emails_per_hour ?? RATE_LIMIT_DEFAULTS.MAX_EMAILS_PER_HOUR;

  // 4. Atomically evaluate and reserve rate limit slot (RATE-02..RATE-06, RATE-09..RATE-12)
  const redisClient = getRedisClient();
  const reservation = await reserveRateLimitSlot(redisClient, {
    senderId: sender.id,
    emailId,
    minSendIntervalMs,
    maxEmailsPerHour,
  });

  const workerToken = token || job.token;

  if (reservation.status === 'quota_exhausted') {
    console.log(
      `[Worker] Hourly quota exhausted for sender ${sender.id} (${reservation.currentCount}/${reservation.maxQuota} emails/hr). Deferring email ${emailId} to next UTC hour (${new Date(reservation.nextEligibleTime).toISOString()}, delay: ${reservation.delayMs}ms).`,
    );
    // Revert status from processing back to 'scheduled' in PostgreSQL (RATE-11, RATE-17)
    await query(
      `UPDATE emails SET status = 'scheduled', updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
      [emailId],
    );
    if (typeof job.moveToDelayed === 'function') {
      await job.moveToDelayed(reservation.nextEligibleTime, workerToken);
    }
    throw new DelayedError();
  }

  if (reservation.status === 'rate_limited') {
    console.log(
      `[Worker] Inter-send spacing active for sender ${sender.id} (${reservation.waitMs}ms remaining). Deferring email ${emailId} to ${new Date(reservation.nextEligibleTime).toISOString()} (delay: ${reservation.delayMs}ms).`,
    );
    // Revert status from processing back to 'scheduled' in PostgreSQL (RATE-02, RATE-03, RATE-11)
    await query(
      `UPDATE emails SET status = 'scheduled', updated_at = NOW() WHERE id = $1 AND status = 'processing'`,
      [emailId],
    );
    if (typeof job.moveToDelayed === 'function') {
      await job.moveToDelayed(reservation.nextEligibleTime, workerToken);
    }
    throw new DelayedError();
  }

  const fromAddress = sender.display_name
    ? `"${sender.display_name}" <${sender.email}>`
    : sender.email;

  // 4. Record new attempt with status 'in_progress'
  const attempt = await withTransaction(async (client) => {
    const countRes = await client.query<{ next_attempt: number }>(
      'SELECT COALESCE(MAX(attempt_number), 0) + 1 as next_attempt FROM email_attempts WHERE email_id = $1',
      [email.id],
    );
    const attemptNumber = countRes.rows[0].next_attempt;

    const insertRes = await client.query<{ id: string }>(
      `INSERT INTO email_attempts (email_id, attempt_number, outcome, started_at)
       VALUES ($1, $2, 'in_progress', NOW())
       RETURNING id;`,
      [email.id, attemptNumber],
    );

    return { id: insertRes.rows[0].id, attemptNumber };
  });

  // 5. Dispatch via SMTP
  const sendResult = await mailer.sendEmailViaSmtp({
    emailId: email.id,
    from: fromAddress,
    to: email.recipient_email,
    subject: email.subject,
    body: email.body,
  });

  // 6. Record delivery outcomes
  if (sendResult.success) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE email_attempts
         SET outcome = 'accepted', provider_message_id = $1, finished_at = NOW()
         WHERE id = $2`,
        [sendResult.providerMessageId, attempt.id],
      );

      await client.query(
        `UPDATE emails
         SET status = 'sent',
             sent_at = NOW(),
             provider_message_id = $1,
             preview_url = $2,
             message_id = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [sendResult.providerMessageId, sendResult.previewUrl, sendResult.messageId, email.id],
      );
    });

    console.log(`[Worker] Email ${email.id} successfully sent to ${email.recipient_email}.`);
    if (sendResult.previewUrl) {
      console.log(`[Worker] Ethereal preview URL: ${sendResult.previewUrl}`);
    }

    return {
      status: 'sent',
      emailId: email.id,
      attemptId: attempt.id,
      previewUrl: sendResult.previewUrl,
      messageId: sendResult.messageId,
    };
  }

  // Handle failure
  const isTransient = sendResult.isTransientError ?? false;
  const errorJson = JSON.stringify({
    code: sendResult.errorCode || 'UNKNOWN_ERROR',
    message: sendResult.errorMessage || 'Failed to send email',
    transient: isTransient,
  });

  const maxAttempts = job.opts?.attempts || DEFAULT_JOB_ATTEMPTS;
  const attemptsMade = typeof job.attemptsMade === 'number' ? job.attemptsMade : 0;
  const isFinalAttempt = attemptsMade + 1 >= maxAttempts;

  if (isTransient) {
    if (isFinalAttempt) {
      // Terminal retry exhaustion: transition email to 'failed' to prevent infinite scheduled stranding
      const exhaustionJson = JSON.stringify({
        code: 'RETRY_EXHAUSTED',
        message: `Maximum delivery attempts (${maxAttempts}) exhausted: ${sendResult.errorMessage}`,
        transient: true,
        lastErrorCode: sendResult.errorCode,
        attemptsMade: job.attemptsMade + 1,
      });

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE email_attempts
           SET outcome = 'rejected', error_code = $1, error_message = $2, finished_at = NOW()
           WHERE id = $3`,
          [sendResult.errorCode, sendResult.errorMessage, attempt.id],
        );

        await client.query(
          `UPDATE emails
           SET status = 'failed', last_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [exhaustionJson, email.id],
        );
      });

      // Refund quota slot on terminal retry exhaustion when non-acceptance is established (RATE-12)
      await refundRateLimitQuota(redisClient, {
        senderId: sender.id,
        emailId,
        windowKey: reservation.windowKey,
      });

      console.error(
        `[Worker] Retry exhausted for email ${email.id} after ${job.attemptsMade + 1}/${maxAttempts} attempts: ${sendResult.errorMessage}`,
      );
      throw new Error(`Retry Exhausted: ${sendResult.errorMessage} (${sendResult.errorCode})`);
    }

    // Transient failure with retries remaining: reset email to 'scheduled' and fail job for BullMQ retry
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE email_attempts
         SET outcome = 'rejected', error_code = $1, error_message = $2, finished_at = NOW()
         WHERE id = $3`,
        [sendResult.errorCode, sendResult.errorMessage, attempt.id],
      );

      await client.query(
        `UPDATE emails
         SET status = 'scheduled', last_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [errorJson, email.id],
      );
    });

    console.warn(
      `[Worker] Transient error sending email ${email.id} (attempt ${attemptsMade + 1}/${maxAttempts}): ${sendResult.errorMessage}`,
    );
    throw new Error(`Transient SMTP Error: ${sendResult.errorMessage} (${sendResult.errorCode})`);
  }

  // Permanent failure (e.g. 5xx response): transition email to 'failed'
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE email_attempts
       SET outcome = 'rejected', error_code = $1, error_message = $2, finished_at = NOW()
       WHERE id = $3`,
      [sendResult.errorCode, sendResult.errorMessage, attempt.id],
    );

    await client.query(
      `UPDATE emails
       SET status = 'failed', last_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [errorJson, email.id],
    );
  });

  // Refund quota on permanent failure since send was rejected (RATE-12)
  await refundRateLimitQuota(redisClient, {
    senderId: sender.id,
    emailId,
    windowKey: reservation.windowKey,
  });

  console.error(`[Worker] Permanent error sending email ${email.id}: ${sendResult.errorMessage}`);
  return {
    status: 'failed',
    emailId: email.id,
    attemptId: attempt.id,
  };
}
