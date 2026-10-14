import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { query, closePool } from '@reachinbox/db';
import { closeQueue, closeRedis, getRedisClient } from '@reachinbox/redis';
import { createSession, SESSION_COOKIE_NAME } from '../../apps/api/src/modules/auth/session.js';
import {
  signSlackState,
  verifySlackState,
  SLACK_STATE_COOKIE_NAME,
} from '../../apps/api/src/modules/slack/slack.service.js';
import { notifySlackQuotaExhausted } from '../../apps/worker/src/slack/notifier.js';
import { encryptToken, decryptToken } from '@reachinbox/shared';

describe('Phase 9 — Slack OAuth, Rate-Limit Notifications, and Bull Board', () => {
  let server: Server;
  let baseUrl: string;
  let testUserId: string;
  let sessionToken: string;

  beforeAll(async () => {
    // 1. Create test user in DB
    const userRes = await query<{ id: string }>(
      `INSERT INTO users (google_subject, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id;`,
      ['slack-test-subject-12345', 'slack-tester@example.com', 'Slack Tester', 'https://avatar.test/slack.png'],
    );
    testUserId = userRes.rows[0].id;

    // 2. Create session for test user
    const session = await createSession(testUserId);
    sessionToken = session.sessionToken;

    // 3. Start API server
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
    // Clean up test database records
    if (testUserId) {
      await query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  // ============================================================================
  // 1. BULL BOARD QUEUE MONITORING & HTTP BASIC AUTH (OPS-01..OPS-03)
  // ============================================================================
  describe('Bull Board Queue Dashboard Protection (OPS-01, OPS-03)', () => {
    it('rejects unauthenticated requests to /admin/queues with 401 and WWW-Authenticate header', async () => {
      const res = await fetch(`${baseUrl}/admin/queues`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Basic realm="ReachInbox Bull Board"');
    });

    it('rejects invalid Basic Auth credentials with 401', async () => {
      const invalidCreds = Buffer.from('wrongUser:wrongPass').toString('base64');
      const res = await fetch(`${baseUrl}/admin/queues`, {
        headers: {
          Authorization: `Basic ${invalidCreds}`,
        },
      });
      expect(res.status).toBe(401);
    });

    it('accepts valid administrator Basic Auth credentials and serves the dashboard', async () => {
      const validCreds = Buffer.from('admin:reachinbox').toString('base64');
      const res = await fetch(`${baseUrl}/admin/queues`, {
        headers: {
          Authorization: `Basic ${validCreds}`,
        },
        redirect: 'manual',
      });
      // Bull board returns either 200 or 302 redirect to /admin/queues/
      expect([200, 301, 302]).toContain(res.status);
    });
  });

  // ============================================================================
  // 2. SLACK OAUTH FLOW & CREDENTIAL SECURITY (SLACK-01..SLACK-06)
  // ============================================================================
  describe('Slack OAuth Installation & Connection Management', () => {
    it('rejects unauthenticated requests to /api/slack/install with 401 (AUTH-07)', async () => {
      const res = await fetch(`${baseUrl}/api/slack/install`, { redirect: 'manual' });
      expect(res.status).toBe(401);
    });

    it('returns 503 SLACK_NOT_CONFIGURED when SLACK_CLIENT_ID is not configured', async () => {
      const origClientId = process.env.SLACK_CLIENT_ID;
      delete process.env.SLACK_CLIENT_ID;

      try {
        const res = await fetch(`${baseUrl}/api/slack/install`, {
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          },
          redirect: 'manual',
        });

        expect(res.status).toBe(503);
        const data = (await res.json()) as { error: { code: string } };
        expect(data.error.code).toBe('SLACK_NOT_CONFIGURED');
      } finally {
        if (origClientId) process.env.SLACK_CLIENT_ID = origClientId;
      }
    });

    it('initiates Slack OAuth redirect with valid state and cookie when configured (SLACK-01, SLACK-02)', async () => {
      process.env.SLACK_CLIENT_ID = 'test-slack-client-id-123';
      process.env.SLACK_CLIENT_SECRET = 'test-slack-client-secret-456';

      const res = await fetch(`${baseUrl}/api/slack/install`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        },
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('https://slack.com/oauth/v2/authorize');
      expect(location).toContain('client_id=test-slack-client-id-123');
      expect(location).toContain('scope=chat%3Awrite%2Cchat%3Awrite.public%2Cincoming-webhook');

      // Verify state cookie was set
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain(`${SLACK_STATE_COOKIE_NAME}=`);
    });

    it('rejects Slack callback with missing code or state with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/slack/callback?code=some-code`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { code: string } };
      expect(data.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects Slack callback with invalid or tampered state with 400 INVALID_SLACK_STATE (SLACK-03)', async () => {
      const res = await fetch(`${baseUrl}/api/slack/callback?code=some-code&state=invalid-tampered-state`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { code: string } };
      expect(data.error.code).toBe('INVALID_SLACK_STATE');
    });

    it('redirects to frontend when Slack returns an authorization error (e.g. access_denied)', async () => {
      const res = await fetch(`${baseUrl}/api/slack/callback?error=access_denied`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('slack_error=access_denied');
    });

    it('successfully completes real OAuth code exchange, stores encrypted tokens, and establishes connection (SLACK-01, SLACK-04, SLACK-05)', async () => {
      process.env.SLACK_CLIENT_ID = 'test-slack-client-id-123';
      process.env.SLACK_CLIENT_SECRET = 'test-slack-client-secret-456';

      // 1. Generate valid signed state for test user
      const signedState = signSlackState(testUserId, 'test-nonce-123');

      // 2. Mock global fetch for Slack's token exchange endpoint
      const originalFetch = global.fetch;
      const mockSlackFetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr === 'https://slack.com/api/oauth.v2.access') {
          return new Response(
            JSON.stringify({
              ok: true,
              access_token: 'xoxb-real-slack-bot-token-secret-999',
              scope: 'chat:write,chat:write.public,incoming-webhook',
              bot_user_id: 'B0123456789',
              team: {
                id: 'T0987654321',
                name: 'ReachInbox Test Workspace',
              },
              incoming_webhook: {
                url: 'https://hooks.slack.com/services/T00/B00/secretwebhook',
                channel: '#rate-limit-alerts',
                channel_id: 'C11223344',
                configuration_url: 'https://reachinbox.slack.com/services/B00',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      });
      global.fetch = mockSlackFetch as unknown as typeof fetch;

      try {
        const res = await fetch(
          `${baseUrl}/api/slack/callback?code=mock-auth-code-777&state=${encodeURIComponent(signedState)}`,
          {
            headers: {
              Cookie: `${SLACK_STATE_COOKIE_NAME}=${signedState}`,
            },
            redirect: 'manual',
          },
        );

        expect(res.status).toBe(302);
        const location = res.headers.get('location') || '';
        expect(location).toContain('slack_connected=true');

        // 3. Inspect database: token must be stored encrypted (SLACK-04, SLACK-05)
        const dbRes = await query<{
          team_id: string;
          team_name: string;
          access_token_encrypted: string;
          incoming_webhook_url_encrypted: string;
          scopes: string;
          channel_name: string;
        }>(
          `SELECT team_id, team_name, access_token_encrypted, incoming_webhook_url_encrypted, scopes, channel_name
           FROM slack_connections WHERE user_id = $1`,
          [testUserId],
        );

        expect(dbRes.rows.length).toBe(1);
        const row = dbRes.rows[0];
        expect(row.team_id).toBe('T0987654321');
        expect(row.team_name).toBe('ReachInbox Test Workspace');
        expect(row.channel_name).toBe('#rate-limit-alerts');

        // Verify token is NOT plaintext in database (SLACK-05)
        expect(row.access_token_encrypted).not.toContain('xoxb-real-slack-bot-token-secret-999');
        // Verify decryption recovers original token
        expect(decryptToken(row.access_token_encrypted)).toBe('xoxb-real-slack-bot-token-secret-999');
        expect(decryptToken(row.incoming_webhook_url_encrypted)).toBe(
          'https://hooks.slack.com/services/T00/B00/secretwebhook',
        );

        // 4. Query connection API (/api/slack/connection) and confirm credentials are NEVER exposed (SLACK-05)
        const connRes = await fetch(`${baseUrl}/api/slack/connection`, {
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          },
        });

        expect(connRes.status).toBe(200);
        const connData = (await connRes.json()) as {
          data: {
            connected: boolean;
            team_id: string;
            team_name: string;
            channel_name: string;
            access_token?: unknown;
            access_token_encrypted?: unknown;
          };
        };

        expect(connData.data.connected).toBe(true);
        expect(connData.data.team_id).toBe('T0987654321');
        expect(connData.data.team_name).toBe('ReachInbox Test Workspace');
        expect(connData.data.channel_name).toBe('#rate-limit-alerts');
        expect(connData.data.access_token).toBeUndefined();
        expect(connData.data.access_token_encrypted).toBeUndefined();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('supports disconnecting Slack workspace and revoking connection (SLACK-06)', async () => {
      const res = await fetch(`${baseUrl}/api/slack/disconnect`, {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { data: { success: boolean } };
      expect(data.data.success).toBe(true);

      // Verify connection is now removed
      const checkRes = await fetch(`${baseUrl}/api/slack/connection`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        },
      });
      const checkData = (await checkRes.json()) as { data: { connected: boolean } };
      expect(checkData.data.connected).toBe(false);
    });
  });

  // ============================================================================
  // 3. REAL RATE-LIMIT SLACK NOTIFICATIONS & DEDUPLICATION (SLACK-07..SLACK-11)
  // ============================================================================
  describe('Rate-Limit Slack Notifications & Resilience', () => {
    it('gracefully skips notification when Slack is disconnected without failing (SLACK-09)', async () => {
      const result = await notifySlackQuotaExhausted({
        senderId: '11111111-2222-3333-4444-555555555555',
        senderEmail: 'test-sender@reachinbox.test',
        userId: testUserId,
        maxQuota: 50,
        currentCount: 50,
        nextEligibleTime: Date.now() + 3600000,
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('not_connected');
    });

    it('sends real Slack rate-limit alert when connected and deduplicates subsequent alerts in the same hour window (SLACK-07, SLACK-08)', async () => {
      const senderId = '22222222-3333-4444-5555-666666666666';

      // 1. Reconnect Slack for test user
      const encryptedToken = encryptToken('xoxb-test-alert-token');
      const encryptedWebhook = encryptToken('https://hooks.slack.com/services/MOCK/ALERT/WEBHOOK');

      await query(
        `INSERT INTO slack_connections (
           user_id, team_id, team_name, access_token_encrypted, scopes,
           channel_name, incoming_webhook_url_encrypted, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           team_id = EXCLUDED.team_id,
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           incoming_webhook_url_encrypted = EXCLUDED.incoming_webhook_url_encrypted;`,
        [
          testUserId,
          'T_ALERT_TEST',
          'Alert Test Team',
          encryptedToken,
          'incoming-webhook',
          '#alerts',
          encryptedWebhook,
        ],
      );

      // 2. Clear any lingering Redis dedup key for this sender
      const redis = getRedisClient();
      const utcHour = new Date().toISOString().substring(0, 13);
      await redis.del(`slack_alert:${senderId}:${utcHour}`);

      // 3. Mock fetch to intercept Slack message dispatch
      const originalFetch = global.fetch;
      let postedPayload: any = null;
      const mockSlackFetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('hooks.slack.com')) {
          postedPayload = JSON.parse(init?.body as string);
          return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
        }
        return originalFetch(url, init);
      });
      global.fetch = mockSlackFetch as unknown as typeof fetch;

      try {
        // First alert: should successfully deliver (SLACK-07)
        const firstAlert = await notifySlackQuotaExhausted({
          senderId,
          senderEmail: 'quota-exhausted@reachinbox.test',
          userId: testUserId,
          maxQuota: 100,
          currentCount: 100,
          nextEligibleTime: Date.now() + 1800000,
        });

        expect(firstAlert.sent).toBe(true);
        expect(firstAlert.reason).toBe('success');
        expect(postedPayload).not.toBeNull();
        expect(postedPayload.text).toContain('ReachInbox Rate Limit Alert');
        expect(postedPayload.text).toContain('quota-exhausted@reachinbox.test');

        // Second alert in same hour window: should be suppressed by Redis atomic deduplication (SLACK-08)
        const secondAlert = await notifySlackQuotaExhausted({
          senderId,
          senderEmail: 'quota-exhausted@reachinbox.test',
          userId: testUserId,
          maxQuota: 100,
          currentCount: 100,
          nextEligibleTime: Date.now() + 1800000,
        });

        expect(secondAlert.sent).toBe(false);
        expect(secondAlert.reason).toBe('duplicate_suppressed');
      } finally {
        global.fetch = originalFetch;
        // Clean up connection
        await query('DELETE FROM slack_connections WHERE user_id = $1', [testUserId]);
      }
    });

    it('safely handles Slack API HTTP 500 error without throwing or failing (SLACK-11)', async () => {
      const senderId = '33333333-4444-5555-6666-777777777777';

      // Connect user to a failing webhook
      const encryptedWebhook = encryptToken('https://hooks.slack.com/services/FAILING/500/WEBHOOK');
      await query(
        `INSERT INTO slack_connections (
           user_id, team_id, team_name, access_token_encrypted, scopes,
           channel_name, incoming_webhook_url_encrypted, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           incoming_webhook_url_encrypted = EXCLUDED.incoming_webhook_url_encrypted;`,
        [
          testUserId,
          'T_FAIL_TEST',
          'Fail Test Team',
          encryptToken('mock-token'),
          'incoming-webhook',
          '#alerts',
          encryptedWebhook,
        ],
      );

      const redis = getRedisClient();
      const utcHour = new Date().toISOString().substring(0, 13);
      await redis.del(`slack_alert:${senderId}:${utcHour}`);

      const originalFetch = global.fetch;
      const mockFailingFetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('hooks.slack.com')) {
          return new Response('Internal Server Error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        return originalFetch(url, init);
      });
      global.fetch = mockFailingFetch as unknown as typeof fetch;

      try {
        const alertRes = await notifySlackQuotaExhausted({
          senderId,
          senderEmail: 'failing-slack@reachinbox.test',
          userId: testUserId,
          maxQuota: 50,
          currentCount: 50,
          nextEligibleTime: Date.now() + 3600000,
        });

        // Must not throw, and must report provider_error gracefully (SLACK-11)
        expect(alertRes.sent).toBe(false);
        expect(alertRes.reason).toBe('provider_error');
      } finally {
        global.fetch = originalFetch;
        await query('DELETE FROM slack_connections WHERE user_id = $1', [testUserId]);
      }
    });
  });
});
