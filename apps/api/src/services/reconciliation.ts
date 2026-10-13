import { withTransaction } from '@reachinbox/db';
import { enqueueEmailJobsBatch, type EnqueueEmailJobParams } from '@reachinbox/redis';

export interface OutboxRecord {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: {
    emailId: string;
    senderId: string;
    userId: string;
    recipientEmail: string;
    subject: string;
    scheduledAt: string;
  };
  attempt_count: number;
}

/**
 * Reconciles un-enqueued scheduling outbox records into BullMQ (BE-10)
 * Recovers jobs that were committed to PostgreSQL but failed initial Redis enqueueing.
 */
export async function reconcilePendingOutbox(): Promise<{
  inspected: number;
  recovered: number;
  failed: number;
}> {
  return withTransaction(async (client) => {
    // Query pending outbox entries with row-level locking
    const pending = await client.query<OutboxRecord>(
      `SELECT id, event_type, aggregate_id, payload, attempt_count
       FROM scheduling_outbox
       WHERE processed_at IS NULL AND event_type = 'EMAIL_SCHEDULED'
       ORDER BY created_at ASC
       LIMIT 100
       FOR UPDATE SKIP LOCKED`,
    );

    if (pending.rows.length === 0) {
      return { inspected: 0, recovered: 0, failed: 0 };
    }

    const jobsToEnqueue: EnqueueEmailJobParams[] = [];
    const validRecords: OutboxRecord[] = [];

    for (const record of pending.rows) {
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
        validRecords.push(record);
      } catch (parseErr) {
        console.error(`Invalid payload for outbox record ${record.id}:`, parseErr);
        await client.query(
          `UPDATE scheduling_outbox
         SET attempt_count = attempt_count + 1, last_error = $1
         WHERE id = $2`,
          [(parseErr as Error).message, record.id],
        );
      }
    }

    if (jobsToEnqueue.length === 0) {
      return { inspected: pending.rows.length, recovered: 0, failed: pending.rows.length };
    }

    try {
      // BullMQ enqueue with deterministic job IDs
      await enqueueEmailJobsBatch(jobsToEnqueue);

      // Mark outbox entries as processed
      const processedIds = validRecords.map((r) => r.id);
      await client.query(
        `UPDATE scheduling_outbox
       SET processed_at = NOW()
       WHERE id = ANY($1)`,
        [processedIds],
      );

      return {
        inspected: pending.rows.length,
        recovered: validRecords.length,
        failed: pending.rows.length - validRecords.length,
      };
    } catch (batchErr) {
      console.error('Failed to batch enqueue outbox records:', batchErr);
      const failedIds = validRecords.map((r) => r.id);
      await client.query(
        `UPDATE scheduling_outbox
       SET attempt_count = attempt_count + 1, last_error = $1
       WHERE id = ANY($2)`,
        [(batchErr as Error).message, failedIds],
      );

      return {
        inspected: pending.rows.length,
        recovered: 0,
        failed: pending.rows.length,
      };
    }
  });
}
