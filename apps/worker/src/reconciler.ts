import { query } from '@reachinbox/db';
import { enqueueEmailJobsBatch, type EnqueueEmailJobParams } from '@reachinbox/redis';

export interface ReconciliationSummary {
  inspectedOutbox: number;
  recoveredOutbox: number;
  recoveredStaleProcessing: number;
}

/**
 * Recovers stranded scheduling outbox events and stale processing jobs (BE-09, BE-10, BE-13, QA-06)
 */
export async function runStartupReconciliation(): Promise<ReconciliationSummary> {
  console.log('[Reconciler] Running startup outbox and job recovery...');

  // 1. Reconcile unprocessed outbox events
  const pendingOutbox = await query<{
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
     LIMIT 200`,
  );

  let recoveredOutbox = 0;

  if (pendingOutbox.rows.length > 0) {
    const jobsToEnqueue: EnqueueEmailJobParams[] = [];
    const validOutboxIds: string[] = [];

    for (const record of pendingOutbox.rows) {
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
      try {
        await enqueueEmailJobsBatch(jobsToEnqueue);
        await query(
          `UPDATE scheduling_outbox
           SET processed_at = NOW()
           WHERE id = ANY($1)`,
          [validOutboxIds],
        );
        recoveredOutbox = validOutboxIds.length;
        console.log(
          `[Reconciler] Successfully recovered ${recoveredOutbox} outbox jobs into BullMQ.`,
        );
      } catch (err) {
        console.error('[Reconciler] Failed to batch enqueue outbox jobs:', err);
      }
    }
  }

  // 2. Reconcile stale 'processing' emails where worker may have crashed mid-execution (BE-13, QA-06)
  // Look for emails stuck in 'processing' for more than 5 minutes
  const staleProcessing = await query<{
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
     LIMIT 100`,
  );

  let recoveredStaleProcessing = 0;

  for (const stale of staleProcessing.rows) {
    // Check if an attempt succeeded before the crash
    const acceptedAttempt = await query<{ provider_message_id: string }>(
      `SELECT provider_message_id FROM email_attempts
       WHERE email_id = $1 AND outcome = 'accepted'
       LIMIT 1`,
      [stale.id],
    );

    if (acceptedAttempt.rows.length > 0) {
      // Reconcile to sent
      await query(
        `UPDATE emails SET status = 'sent', sent_at = NOW(), provider_message_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [acceptedAttempt.rows[0].provider_message_id, stale.id],
      );
      recoveredStaleProcessing++;
    } else {
      // Revert to scheduled and re-enqueue
      await query(
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
      } catch (err) {
        console.error(`[Reconciler] Failed to re-enqueue stale email ${stale.id}:`, err);
      }
    }
  }

  return {
    inspectedOutbox: pendingOutbox.rows.length,
    recoveredOutbox,
    recoveredStaleProcessing,
  };
}
