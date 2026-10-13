import { withTransaction, query } from '@reachinbox/db';
import { enqueueEmailJobsBatch, type EnqueueEmailJobParams } from '@reachinbox/redis';
import { parseRecipients, type ScheduleEmailInput } from '@reachinbox/shared';

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
 * Service orchestrating transactional email persistence and BullMQ delayed enqueueing (BE-01, BE-02, BE-03, BE-05, BE-07)
 */
export async function scheduleEmails(
  userId: string,
  input: ScheduleEmailInput,
  idempotencyKey?: string,
  requestHash?: string,
): Promise<ScheduleResult> {
  // 1. Validate that the sender exists and belongs to the user
  const senderRes = await query<{ id: string }>(
    'SELECT id FROM senders WHERE id = $1 AND user_id = $2',
    [input.sender_id, userId],
  );

  if (senderRes.rows.length === 0) {
    const error = new Error(`Sender with id '${input.sender_id}' not found for user`);
    (error as unknown as { code: string }).code = 'SENDER_NOT_FOUND';
    throw error;
  }

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

  const scheduledDate = new Date(input.scheduled_at);

  // 3. Transactional PostgreSQL persistence: Email records + Outbox events (BE-02, BE-10)
  const createdEmails = await withTransaction(async (client) => {
    const emailRows: ScheduledEmailRecord[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const itemKey = idempotencyKey ? `${idempotencyKey}:${i}` : null;

      const emailInsert = await client.query<ScheduledEmailRecord>(
        `INSERT INTO emails (
          user_id, sender_id, recipient_email, subject, body, scheduled_at, status, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7)
        RETURNING id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, created_at;`,
        [userId, input.sender_id, recipient, input.subject, input.body, scheduledDate, itemKey],
      );

      const email = emailInsert.rows[0];

      // Update bullmq_job_id to match email.id deterministically (BE-07)
      await client.query('UPDATE emails SET bullmq_job_id = $1 WHERE id = $2', [
        email.id,
        email.id,
      ]);
      email.bullmq_job_id = email.id;

      // Insert into scheduling_outbox
      await client.query(
        `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload)
         VALUES ('EMAIL_SCHEDULED', $1, $2);`,
        [
          email.id,
          JSON.stringify({
            emailId: email.id,
            senderId: email.sender_id,
            userId,
            recipientEmail: email.recipient_email,
            subject: email.subject,
            scheduledAt: scheduledDate.toISOString(),
          }),
        ],
      );

      emailRows.push(email);
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

  // 4. Enqueue BullMQ delayed jobs with deterministic job IDs (BE-05, BE-07)
  const jobParams: EnqueueEmailJobParams[] = createdEmails.map((e) => ({
    emailId: e.id,
    senderId: e.sender_id,
    userId: e.user_id,
    recipientEmail: e.recipient_email,
    subject: e.subject,
    scheduledAt: scheduledDate,
  }));

  try {
    await enqueueEmailJobsBatch(jobParams);

    // Mark outbox events as processed
    const emailIds = createdEmails.map((e) => e.id);
    await query('UPDATE scheduling_outbox SET processed_at = NOW() WHERE aggregate_id = ANY($1)', [
      emailIds,
    ]);
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
