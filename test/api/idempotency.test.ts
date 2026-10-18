import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { query, closePool } from '@email-scheduler/db';
import { closeQueue, closeRedis } from '@email-scheduler/redis';
import { DEFAULT_DEV_SENDER_ID, DEFAULT_DEV_USER_ID, ensureDefaultDevUser } from '../../apps/api/src/middleware/auth.js';
import { createSession } from '../../apps/api/src/modules/auth/session.js';

describe('API Idempotency and Conflict Detection (BE-08, QA-04)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await ensureDefaultDevUser();
    const { sessionToken } = await createSession(DEFAULT_DEV_USER_ID);
    sessionCookie = `email_scheduler_session=${sessionToken}`;

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

  it('replaying identical request with same Idempotency-Key returns cached response without duplicate database rows (BE-08, QA-04)', async () => {
    const idempotencyKey = `key_idem_${Date.now()}`;
    const futureDate = new Date(Date.now() + 1800000).toISOString();
    const payload = {
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: `idempotent_${Date.now()}@example.com`,
      subject: 'Idempotency Test Subject',
      body: 'Idempotency Test Body Content',
      scheduled_at: futureDate,
    };

    // 1. Initial request
    const res1 = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: sessionCookie,
      },
      body: JSON.stringify(payload),
    });

    expect(res1.status).toBe(201);
    expect(res1.headers.get('Idempotency-Replayed')).toBeNull();
    const body1 = (await res1.json()) as { data: { id: string } };
    const emailId = body1.data.id;

    // Count emails in database for this recipient
    const countBefore = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM emails WHERE recipient_email = $1',
      [payload.recipient_email],
    );
    expect(parseInt(countBefore.rows[0].count, 10)).toBe(1);

    // 2. Replayed request with exact same key and payload
    const res2 = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: sessionCookie,
      },
      body: JSON.stringify(payload),
    });

    expect(res2.status).toBe(201);
    expect(res2.headers.get('Idempotency-Replayed')).toBe('true');
    const body2 = (await res2.json()) as { data: { id: string } };
    expect(body2.data.id).toBe(emailId); // Exact same email ID returned

    // 3. Confirm database row count did NOT increase (Zero duplicate work)
    const countAfter = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM emails WHERE recipient_email = $1',
      [payload.recipient_email],
    );
    expect(parseInt(countAfter.rows[0].count, 10)).toBe(1);
  });

  it('reusing an Idempotency-Key with a different payload returns 409 Conflict', async () => {
    const idempotencyKey = `key_conflict_${Date.now()}`;
    const futureDate = new Date(Date.now() + 1800000).toISOString();

    const payload1 = {
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: 'original@example.com',
      subject: 'Original Subject',
      body: 'Original Body',
      scheduled_at: futureDate,
    };

    // First request
    const res1 = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: sessionCookie,
      },
      body: JSON.stringify(payload1),
    });
    expect(res1.status).toBe(201);

    // Different payload with same key
    const payload2 = {
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: 'modified@example.com',
      subject: 'Modified Different Subject',
      body: 'Modified Body',
      scheduled_at: futureDate,
    };

    const res2 = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: sessionCookie,
      },
      body: JSON.stringify(payload2),
    });

    expect(res2.status).toBe(409);
    const body2 = (await res2.json()) as { error: { code: string; message: string } };
    expect(body2.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(body2.error.message).toContain('different request payload');
  });

  it('concurrent identical requests with the same Idempotency-Key create exactly one email', async () => {
    const idempotencyKey = `key_concurrent_${Date.now()}`;
    const futureDate = new Date(Date.now() + 1800000).toISOString();
    const payload = {
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: `concurrent_${Date.now()}@example.com`,
      subject: 'Concurrent Test Subject',
      body: 'Concurrent Body Content',
      scheduled_at: futureDate,
    };

    const executeRequest = () =>
      fetch(`${baseUrl}/api/emails/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Cookie: sessionCookie,
        },
        body: JSON.stringify(payload),
      });

    // Launch parallel concurrent requests
    const [resA, resB] = await Promise.all([executeRequest(), executeRequest()]);

    expect([200, 201]).toContain(resA.status);
    expect([200, 201]).toContain(resB.status);

    const bodyA = (await resA.json()) as { data: { id: string } };
    const bodyB = (await resB.json()) as { data: { id: string } };
    expect(bodyA.data.id).toBe(bodyB.data.id);

    // Assert only one row was inserted
    const countRes = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM emails WHERE recipient_email = $1',
      [payload.recipient_email],
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });
});
