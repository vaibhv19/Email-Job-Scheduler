import crypto from 'crypto';
import { withTransaction, query } from '@reachinbox/db';
import { enqueueEmailJobsBatch, type EnqueueEmailJobParams } from '@reachinbox/redis';
import { parseRecipients, type ScheduleEmailInput, RATE_LIMIT_DEFAULTS } from '@reachinbox/shared';
import { bulkIndexEmails } from './elasticsearch.js';

export interface ScheduledEmailRecord {
  id: string;
  user_id: string;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: string;
  bullmq_job_id: string;
  created_at: string;
}

export interface ScheduleResult {
  isBulk: boolean;
  scheduledCount: number;
  data: ScheduledEmailRecord | ScheduledEmailRecord[];
}

/**
 * Service orchestrating transactional email persistence, staggered batch scheduling,
 * and BullMQ delayed enqueueing (BE-01..BE-07, RATE-13, RATE-16, RATE-20, RATE-21)
 */
export async function scheduleEmails(
  userId: string,
  input: ScheduleEmailInput,
  idempotencyKey?: string,
  requestHash?: string,
): Promise<ScheduleResult> {
  // 1. Validate that the sender exists and belongs to the user, and retrieve rate limit configuration (RATE-06, RATE-07)
  const senderRes = await query<{
    id: string;
    email: string;
    min_send_interval_ms: number;
    max_emails_per_hour: number;
  }>(
    'SELECT id, email, min_send_interval_ms, max_emails_per_hour FROM senders WHERE id = $1 AND user_id = $2',
    [input.sender_id, userId],
  );

  if (senderRes.rows.length === 0) {
    const error = new Error(`Sender with id '${input.sender_id}' not found for user`);
    (error as unknown as { code: string }).code = 'SENDER_NOT_FOUND';
    throw error;
  }

  const sender = senderRes.rows[0];
  const minSendIntervalMs = sender.min_send_interval_ms ?? RATE_LIMIT_DEFAULTS.MIN_SEND_INTERVAL_MS;

  // 2. Resolve and deduplicate recipients (QA-12)
  const rawRecipients: string[] = [];
  if (input.recipient_email) {
    rawRecipients.push(input.recipient_email);
  }
  if (input.recipient_emails && input.recipient_emails.length > 0) {
    rawRecipients.push(...input.recipient_emails);
  }
  if (input.recipients_raw) {
    const parsed = parseRecipients(input.recipients_raw);
    rawRecipients.push(...parsed.valid);
  }

  const { valid: recipients } = parseRecipients(rawRecipients);

  if (recipients.length === 0) {
    const error = new Error('No valid recipient email addresses found in request');
    (error as unknown as { code: string }).code = 'INVALID_RECIPIENTS';
    throw error;
  }

  const baseScheduledDate = new Date(input.scheduled_at);

  // 3. Transactional PostgreSQL persistence using chunked bulk inserts (BE-02, BE-10, RATE-13, RATE-16)
  // Avoids holding open single-row lock iterations for large batches (up to 1,000+ recipients)
  const createdEmails = await withTransaction(async (client) => {
    const emailRows: ScheduledEmailRecord[] = [];
    const CHUNK_SIZE = 100;

    for (let c = 0; c < recipients.length; c += CHUNK_SIZE) {
      const chunk = recipients.slice(c, c + CHUNK_SIZE);
      const emailValues: unknown[] = [];
      const emailPlaceholders: string[] = [];

      for (let j = 0; j < chunk.length; j++) {
        const i = c + j;
        const recipient = chunk[j];
        const emailId = crypto.randomUUID();
        // Stagger scheduled timestamps by min_send_interval_ms for batches (RATE-16, RATE-20, RATE-21)
        const recipientScheduledDate =
          recipients.length > 1
            ? new Date(baseScheduledDate.getTime() + i * minSendIntervalMs)
            : baseScheduledDate;
        const itemKey = idempotencyKey ? `${idempotencyKey}:${i}` : null;

        const offset = j * 9;
        emailPlaceholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, 'scheduled', $${offset + 8}, $${offset + 9})`,
        );
        emailValues.push(
          emailId,
          userId,
          input.sender_id,
          recipient,
          input.subject,
          input.body,
          recipientScheduledDate,
          itemKey,
          emailId, // bullmq_job_id matches email.id deterministically (BE-07)
        );
      }

      const emailInsert = await client.query<ScheduledEmailRecord>(
        `INSERT INTO emails (
          id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, idempotency_key, bullmq_job_id
        ) VALUES ${emailPlaceholders.join(', ')}
        RETURNING id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, bullmq_job_id, created_at;`,
        emailValues,
      );

      emailRows.push(...emailInsert.rows);

      // Multi-row insert into scheduling_outbox for guaranteed recovery (BE-10)
      const outboxPlaceholders: string[] = [];
      const outboxValues: unknown[] = [];
      for (let j = 0; j < emailInsert.rows.length; j++) {
        const row = emailInsert.rows[j];
        const offset = j * 2;
        outboxPlaceholders.push(`('EMAIL_SCHEDULED', $${offset + 1}, $${offset + 2})`);
        outboxValues.push(
          row.id,
          JSON.stringify({
            emailId: row.id,
            senderId: row.sender_id,
            userId,
            recipientEmail: row.recipient_email,
            subject: row.subject,
            scheduledAt: new Date(row.scheduled_at).toISOString(),
          }),
        );
      }

      await client.query(
        `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload)
         VALUES ${outboxPlaceholders.join(', ')};`,
        outboxValues,
      );
    }

    if (idempotencyKey && requestHash) {
      const responseData = emailRows.length === 1 ? emailRows[0] : emailRows;
      const responseBody = {
        isBulk: recipients.length > 1,
        scheduledCount: emailRows.length,
        data: responseData,
      };
      await client.query(
        `INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, response_status, response_body)
         VALUES ($1, $2, $3, 201, $4)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING;`,
        [userId, idempotencyKey, requestHash, JSON.stringify(responseBody)],
      );
    }

    return emailRows;
  });

  // 4. Enqueue BullMQ delayed jobs with deterministic job IDs using addBulk (BE-05, BE-07, RATE-13)
  const jobParams: EnqueueEmailJobParams[] = createdEmails.map((e) => ({
    emailId: e.id,
    senderId: e.sender_id,
    userId: e.user_id,
    recipientEmail: e.recipient_email,
    subject: e.subject,
    scheduledAt: new Date(e.scheduled_at),
  }));

  try {
    await enqueueEmailJobsBatch(jobParams);

    // Mark outbox events as processed
    const emailIds = createdEmails.map((e) => e.id);
    await query('UPDATE scheduling_outbox SET processed_at = NOW() WHERE aggregate_id = ANY($1)', [
      emailIds,
    ]);

    // Index emails in Elasticsearch
    await bulkIndexEmails(
      createdEmails.map((e) => ({
        id: e.id,
        user_id: e.user_id,
        sender_id: e.sender_id,
        sender_email: sender.email,
        recipient_email: e.recipient_email,
        subject: e.subject,
        body: e.body,
        status: e.status,
        scheduled_at: new Date(e.scheduled_at).toISOString(),
        created_at: new Date(e.created_at).toISOString(),
      })),
    );
  } catch (queueErr) {
    // If BullMQ fails, PostgreSQL transaction is already committed.
    // Outbox events remain with processed_at IS NULL for the outbox reconciler (BE-10).
    console.warn(
      '[Queue] BullMQ enqueue failure during scheduling; outbox event retained for recovery:',
      queueErr,
    );
  }

  const isBulk = createdEmails.length > 1;
  return {
    isBulk,
    scheduledCount: createdEmails.length,
    data: isBulk ? createdEmails : createdEmails[0],
  };
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  senderId?: string;
  status?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Lists scheduled emails scoped to user with pagination (BE-14)
 */
export async function listScheduledEmails(
  userId: string,
  options: PaginationOptions,
): Promise<PaginatedResult<ScheduledEmailRecord>> {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['user_id = $1', "status = 'scheduled'"];
  const params: unknown[] = [userId];

  if (options.senderId) {
    params.push(options.senderId);
    conditions.push(`sender_id = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM emails WHERE ${whereClause}`,
    params,
  );
  const total = parseInt(countRes.rows[0]?.count || '0', 10);

  const queryParams = [...params, limit, offset];
  const dataRes = await query<ScheduledEmailRecord>(
    `SELECT id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, bullmq_job_id, created_at
     FROM emails
     WHERE ${whereClause}
     ORDER BY scheduled_at ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    queryParams,
  );

  return {
    data: dataRes.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Lists sent and failed emails scoped to user with pagination (BE-14)
 */
export async function listSentEmails(
  userId: string,
  options: PaginationOptions,
): Promise<PaginatedResult<ScheduledEmailRecord>> {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['user_id = $1'];
  const params: unknown[] = [userId];

  if (options.status && (options.status === 'sent' || options.status === 'failed')) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  } else {
    conditions.push("status IN ('sent', 'failed')");
  }

  if (options.senderId) {
    params.push(options.senderId);
    conditions.push(`sender_id = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM emails WHERE ${whereClause}`,
    params,
  );
  const total = parseInt(countRes.rows[0]?.count || '0', 10);

  const queryParams = [...params, limit, offset];
  const dataRes = await query<ScheduledEmailRecord>(
    `SELECT id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, bullmq_job_id, created_at
     FROM emails
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    queryParams,
  );

  return {
    data: dataRes.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieves a single email by ID with user ownership check (BE-14)
 */
export async function getEmailById(
  userId: string,
  emailId: string,
): Promise<ScheduledEmailRecord | null> {
  const res = await query<ScheduledEmailRecord>(
    'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
    [emailId, userId],
  );
  return res.rows[0] || null;
}
