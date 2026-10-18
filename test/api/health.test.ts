import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { closePool } from '@email-scheduler/db';
import { closeRedis } from '@email-scheduler/redis';

describe('API Health and Readiness Endpoints (INF-03, INF-12)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
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
    await closePool();
    await closeRedis();
  });

  it('GET /health returns 200 OK with uptime and timestamp', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number; timestamp: string };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /ready returns 200 OK and reports healthy status for database, redis, and elasticsearch', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: { database: string; redis: string; elasticsearch: string };
      timestamp: string;
    };
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.redis).toBe('ok');
    expect(body.checks.elasticsearch).toBe('ok');
  });

  it('returns 404 with structured error envelope for nonexistent routes', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
