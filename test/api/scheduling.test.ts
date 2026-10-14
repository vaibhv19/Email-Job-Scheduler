import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { query, closePool } from '@reachinbox/db';
import { getEmailQueue, closeQueue, closeRedis } from '@reachinbox/redis';
import { DEFAULT_DEV_SENDER_ID, DEFAULT_DEV_USER_ID, ensureDefaultDevUser } from '../../apps/api/src/middleware/auth.js';
import { createSession } from '../../apps/api/src/modules/auth/session.js';

describe('Email Scheduling and Queue Producer (BE-01, BE-02, BE-03, BE-05, BE-07, BE-14, BE-15)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await ensureDefaultDevUser();
    const { sessionToken } = await createSession(DEFAULT_DEV_USER_ID);
    sessionCookie = `reachinbox_session=${sessionToken}`;

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('schedules a single recipient email, persists to DB, and enqueues delayed BullMQ job (BE-01, BE-02, BE-05, BE-07)', async () => {
    const futureDate = new Date(Date.now() + 600000); // 10 minutes from now
    const recipient = `single_test_${Date.now()}@example.com`;

    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        recipient_email: recipient,
        subject: 'Single Email Scheduling Test',
        body: 'Hello World Body Content',
        scheduled_at: futureDate.toISOString(),
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      isBulk: boolean;
      scheduledCount: number;
      data: { id: string; recipient_email: string; bullmq_job_id: string; status: string };
    };

    expect(body.isBulk).toBe(false);
    expect(body.scheduledCount).toBe(1);
    const email = body.data;
    expect(email.id).toBeDefined();
    expect(email.bullmq_job_id).toBe(email.id); // Deterministic Job ID (BE-07)
    expect(email.status).toBe('scheduled');

    // 1. Verify PostgreSQL persistence (BE-02)
    const dbRes = await query<{ id: string; status: string; recipient_email: string }>(
      'SELECT id, status, recipient_email FROM emails WHERE id = $1',
      [email.id],
    );
    expect(dbRes.rows.length).toBe(1);
    expect(dbRes.rows[0].status).toBe('scheduled');
    expect(dbRes.rows[0].recipient_email).toBe(recipient);

    // 2. Verify BullMQ delayed job in Redis (BE-05, BE-07)
    const queue = getEmailQueue();
    const job = await queue.getJob(email.id);
    expect(job).toBeDefined();
    expect(job?.id).toBe(email.id);
    expect(job?.data.recipientEmail).toBe(recipient);
    expect(job?.delay).toBeGreaterThan(0);
  });

  it('schedules bulk recipient emails in batch, persists distinct records, and enqueues delayed jobs (BE-03)', async () => {
    const futureDate = new Date(Date.now() + 1200000); // 20 minutes from now
    const recipients = [
      `bulk_1_${Date.now()}@example.com`,
      `bulk_2_${Date.now()}@example.com`,
      `bulk_3_${Date.now()}@example.com`,
    ];

    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        recipient_emails: recipients,
        subject: 'Bulk Scheduling Test',
        body: 'Bulk Body Content',
        scheduled_at: futureDate.toISOString(),
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      isBulk: boolean;
      scheduledCount: number;
      data: Array<{ id: string; recipient_email: string; bullmq_job_id: string }>;
    };

    expect(body.isBulk).toBe(true);
    expect(body.scheduledCount).toBe(3);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(3);

    const queue = getEmailQueue();
    for (const email of body.data) {
      expect(recipients).toContain(email.recipient_email);
      expect(email.bullmq_job_id).toBe(email.id);

      const job = await queue.getJob(email.id);
      expect(job).toBeDefined();
      expect(job?.id).toBe(email.id);
    }
  });

  it('lists scheduled emails with pagination metadata (BE-14)', async () => {
    const res = await fetch(`${baseUrl}/api/emails/scheduled?page=1&limit=2`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: Array<{ id: string; status: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('retrieves single email by ID and enforces cross-user data isolation (BE-14)', async () => {
    // 1. Create email for default user
    const futureDate = new Date(Date.now() + 600000).toISOString();
    const createRes = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        recipient_email: 'owner@example.com',
        subject: 'Owner Test',
        body: 'Owner Body',
        scheduled_at: futureDate,
      }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const emailId = created.data.id;

    // 2. Fetch by owner -> 200 OK
    const ownerRes = await fetch(`${baseUrl}/api/emails/${emailId}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(ownerRes.status).toBe(200);
    const ownerBody = (await ownerRes.json()) as { email: { id: string; user_id: string } };
    expect(ownerBody.email.id).toBe(emailId);
    expect(ownerBody.email.user_id).toBe(DEFAULT_DEV_USER_ID);

    // 3. Create another user in DB with a separate real session
    const otherUserId = '00000000-0000-0000-0000-000000000099';
    await query(
      `INSERT INTO users (id, google_subject, email, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING;`,
      [otherUserId, 'other_google_sub', 'other@reachinbox.test', 'Other User'],
    );
    const { sessionToken: otherSessionToken } = await createSession(otherUserId);

    // 4. Fetch by other user's session -> 404 Not Found (Cross-tenant security)
    const otherRes = await fetch(`${baseUrl}/api/emails/${emailId}`, {
      headers: { Cookie: `reachinbox_session=${otherSessionToken}` },
    });
    expect(otherRes.status).toBe(404);

    // 5. Unauthenticated request -> 401 Unauthorized
    const unauthRes = await fetch(`${baseUrl}/api/emails/${emailId}`);
    expect(unauthRes.status).toBe(401);
  });
});
