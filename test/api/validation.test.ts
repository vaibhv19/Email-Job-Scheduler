import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { closePool } from '@email-scheduler/db';
import { closeRedis, closeQueue } from '@email-scheduler/redis';
import { DEFAULT_DEV_SENDER_ID, DEFAULT_DEV_USER_ID, ensureDefaultDevUser } from '../../apps/api/src/middleware/auth.js';
import { createSession, SESSION_COOKIE_NAME } from '../../apps/api/src/modules/auth/session.js';

describe('API Request Validation and Error Envelope (QA-01, BE-04, BE-16, BE-17)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await ensureDefaultDevUser();
    const { sessionToken } = await createSession(DEFAULT_DEV_USER_ID);
    sessionCookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;

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

  it('rejects payload missing subject and body with 400 and field details', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        recipient_email: 'user@example.com',
        scheduled_at: futureDate,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
  });

  it('rejects invalid recipient email address with 400 Bad Request', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        recipient_email: 'not-an-email',
        subject: 'Valid Subject',
        body: 'Valid Body',
        scheduled_at: futureDate,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Invalid recipient email address');
  });

  it('rejects scheduled_at in the past with 400 Bad Request (BE-16)', async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        recipient_email: 'user@example.com',
        subject: 'Valid Subject',
        body: 'Valid Body',
        scheduled_at: pastDate,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('scheduled_at cannot be in the past');
  });

  it('rejects request with no recipients provided with 400 Bad Request', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: DEFAULT_DEV_SENDER_ID,
        subject: 'Valid Subject',
        body: 'Valid Body',
        scheduled_at: futureDate,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('At least one recipient must be provided');
  });

  it('rejects invalid sender_id format (non-UUID) with 400 Bad Request', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/emails/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        sender_id: 'not-a-valid-uuid',
        recipient_email: 'user@example.com',
        subject: 'Valid Subject',
        body: 'Valid Body',
        scheduled_at: futureDate,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('sender_id must be a valid UUID');
  });
});
