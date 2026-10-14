import { getPool } from '@reachinbox/db';
import {
  enqueueEmailJobsBatch,
  getEmailQueue,
  type EnqueueEmailJobParams,
} from '@reachinbox/redis';

export interface ReconciliationSummary {
  inspectedOutbox: number;
  recoveredOutbox: number;
  recoveredStaleProcessing: number;
  skippedActiveProcessing: number;
  ambiguousCrashesHandled: number;
  lockSkipped: boolean;
}

export interface RunReconciliationOptions {
  maxLockRetries?: number;
  retryDelayMs?: number;
}

/**
 * Recovers stranded scheduling outbox events and stale processing jobs (BE-09, BE-10, BE-13, QA-06, SMTP-08)
 * Coordinated across worker instances via PostgreSQL advisory lock and row-level locking.
 */
export async function runStartupReconciliation(
  options?: RunReconciliationOptions,
): Promise<ReconciliationSummary> {
  const pool = getPool();
  const client = await pool.connect();
  let lockAcquired = false;

  const maxLockRetries = options?.maxLockRetries ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 50;

  try {
    // 1. Acquire coordination lock via PostgreSQL advisory lock
    for (let attempt = 0; attempt <= maxLockRetries; attempt++) {
      const lockRes = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('reachinbox_reconciliation')) AS locked",
      );

      if (lockRes.rows[0].locked) {
        lockAcquired = true;
        break;
      }

      if (attempt < maxLockRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!lockAcquired) {
      console.log('[Reconciler] Reconciliation already in progress by another worker. Skipping.');
      return {
        inspectedOutbox: 0,
        recoveredOutbox: 0,
        recoveredStaleProcessing: 0,
        skippedActiveProcessing: 0,
        ambiguousCrashesHandled: 0,
        lockSkipped: true,
      };
    }

    let recoveredOutbox = 0;
    let recoveredStaleProcessing = 0;
    let skippedActiveProcessing = 0;
    let ambiguousCrashesHandled = 0;

    // 2. Reconcile unprocessed outbox events with row locking (FOR UPDATE SKIP LOCKED)
    await client.query('BEGIN');
    let pendingOutboxRows: Array<{
      id: string;
      aggregate_id: string;
      payload:
        | string
        | {
            emailId: string;
            senderId: string;
            userId: string;
            recipientEmail: string;
            subject: string;
            scheduledAt: string;
          };
    }> = [];

    try {
      const pendingOutbox = await client.query<{
        id: string;
        aggregate_id: string;
        payload:
          | string
          | {
              emailId: string;
              senderId: string;
              userId: string;
              recipientEmail: string;
              subject: string;
              scheduledAt: string;
            };
      }>(
        `SELECT id, aggregate_id, payload
         FROM scheduling_outbox
         WHERE processed_at IS NULL AND event_type = 'EMAIL_SCHEDULED'
         ORDER BY created_at ASC
         LIMIT 200
         FOR UPDATE SKIP LOCKED`,
      );

      pendingOutboxRows = pendingOutbox.rows;

      if (pendingOutboxRows.length > 0) {
        const jobsToEnqueue: EnqueueEmailJobParams[] = [];
        const validOutboxIds: string[] = [];

        for (const record of pendingOutboxRows) {
          try {
            const payload =
              typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
            jobsToEnqueue.push({
              emailId: payload.emailId || record.aggregate_id,
              senderId: payload.senderId,
              userId: payload.userId,
              recipientEmail: payload.recipientEmail,
              subject: payload.subject,
              scheduledAt: new Date(payload.scheduledAt),
            });
            validOutboxIds.push(record.id);
          } catch (err) {
            console.error(`[Reconciler] Corrupt outbox payload for record ${record.id}:`, err);
          }
        }

        if (jobsToEnqueue.length > 0) {
          await enqueueEmailJobsBatch(jobsToEnqueue);
          await client.query(
            `UPDATE scheduling_outbox
             SET processed_at = NOW()
             WHERE id = ANY($1)`,
            [validOutboxIds],
          );
          recoveredOutbox = validOutboxIds.length;
          console.log(
            `[Reconciler] Successfully recovered ${recoveredOutbox} outbox jobs into BullMQ.`,
          );
        }
      }
      await client.query('COMMIT');
    } catch (outboxErr) {
      await client.query('ROLLBACK');
      console.error('[Reconciler] Failed to reconcile outbox batch:', outboxErr);
    }

    // 3. Reconcile stale 'processing' emails (crashed workers / ambiguous outcomes)
    await client.query('BEGIN');
    try {
      const staleProcessing = await client.query<{
        id: string;
        scheduled_at: string;
        sender_id: string;
        user_id: string;
        recipient_email: string;
        subject: string;
      }>(
        `SELECT id, scheduled_at, sender_id, user_id, recipient_email, subject
         FROM emails
         WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'
         ORDER BY updated_at ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED`,
      );

      const queue = getEmailQueue();

      for (const stale of staleProcessing.rows) {
        // A. Guard: Verify whether a worker is genuinely actively executing this job in BullMQ
        try {
          const job = await queue.getJob(stale.id);
          if (job && (await job.isActive())) {
            console.log(
              `[Reconciler] Email ${stale.id} is actively being processed by a running worker. Skipping.`,
            );
            skippedActiveProcessing++;
            continue;
          }
        } catch (queueCheckErr) {
          console.warn(
            `[Reconciler] Warning checking BullMQ job state for ${stale.id}:`,
            queueCheckErr,
          );
        }

        // B. Check if an attempt was successfully accepted by SMTP before crash
        const acceptedAttempt = await client.query<{ provider_message_id: string }>(
          `SELECT provider_message_id FROM email_attempts
           WHERE email_id = $1 AND outcome = 'accepted'
           LIMIT 1`,
          [stale.id],
        );

        if (acceptedAttempt.rows.length > 0) {
          // Worker finished SMTP send and recorded accepted attempt before dying
          await client.query(
            `UPDATE emails
             SET status = 'sent', sent_at = NOW(), provider_message_id = $1, updated_at = NOW()
             WHERE id = $2`,
            [acceptedAttempt.rows[0].provider_message_id, stale.id],
          );
          recoveredStaleProcessing++;
          continue;
        }

        // C. Check the latest attempt outcome
        const latestAttempt = await client.query<{
          id: string;
          attempt_number: number;
          outcome: string;
        }>(
          `SELECT id, attempt_number, outcome FROM email_attempts
           WHERE email_id = $1
           ORDER BY attempt_number DESC
           LIMIT 1`,
          [stale.id],
        );

        if (latestAttempt.rows.length > 0 && latestAttempt.rows[0].outcome === 'in_progress') {
          // Ambiguous outcome: Worker started send but crashed mid-flight.
          // We cannot determine whether SMTP accepted it; do NOT blindly resend.
          await client.query(
            `UPDATE email_attempts
             SET outcome = 'unknown',
                 error_code = 'AMBIGUOUS_CRASH_OUTCOME',
                 error_message = 'Worker process terminated while attempt was in progress; delivery outcome is ambiguous',
                 finished_at = NOW()
             WHERE id = $1`,
            [latestAttempt.rows[0].id],
          );

          const ambiguousError = JSON.stringify({
            code: 'AMBIGUOUS_CRASH_OUTCOME',
            message:
              'Worker terminated while attempt was in progress. SMTP acceptance is ambiguous; marked failed to prevent duplicate send.',
            requiresManualReview: true,
          });

          await client.query(
            `UPDATE emails
             SET status = 'failed', last_error = $1, updated_at = NOW()
             WHERE id = $2`,
            [ambiguousError, stale.id],
          );

          ambiguousCrashesHandled++;
          console.warn(
            `[Reconciler] Handled ambiguous crash for email ${stale.id}; marked attempt as 'unknown' and email as 'failed'.`,
          );
          continue;
        }

        // D. Worker claimed the email but crashed before initiating any SMTP attempt
        // Safe to revert to 'scheduled' and re-enqueue
        await client.query(
          `UPDATE emails SET status = 'scheduled', updated_at = NOW()
           WHERE id = $1`,
          [stale.id],
        );

        try {
          await enqueueEmailJobsBatch([
            {
              emailId: stale.id,
              senderId: stale.sender_id,
              userId: stale.user_id,
              recipientEmail: stale.recipient_email,
              subject: stale.subject,
              scheduledAt: new Date(stale.scheduled_at),
            },
          ]);
          recoveredStaleProcessing++;
        } catch (enqueueErr) {
          console.error(`[Reconciler] Failed to re-enqueue stale email ${stale.id}:`, enqueueErr);
        }
      }
      await client.query('COMMIT');
    } catch (staleErr) {
      await client.query('ROLLBACK');
      console.error('[Reconciler] Failed to reconcile stale processing emails:', staleErr);
    }

    if (recoveredOutbox > 0 || recoveredStaleProcessing > 0 || ambiguousCrashesHandled > 0) {
      console.log(
        `[Reconciler] Recovery complete: outbox recovered=${recoveredOutbox}, stale processing recovered=${recoveredStaleProcessing}, ambiguous crashes=${ambiguousCrashesHandled}.`,
      );
    }

    return {
      inspectedOutbox: pendingOutboxRows.length,
      recoveredOutbox,
      recoveredStaleProcessing,
      skippedActiveProcessing,
      ambiguousCrashesHandled,
      lockSkipped: false,
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext('reachinbox_reconciliation'))");
      } catch (unlockErr) {
        console.warn('[Reconciler] Failed to release advisory lock:', unlockErr);
      }
    }
    client.release();
  }
}
