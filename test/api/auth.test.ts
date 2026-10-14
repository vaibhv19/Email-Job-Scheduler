import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { query, closePool } from '@reachinbox/db';
import { closeQueue, closeRedis } from '@reachinbox/redis';
import {
  createSession,
  invalidateSession,
  validateSession,
  hashSessionToken,
  SESSION_COOKIE_NAME,
} from '../../apps/api/src/modules/auth/session.js';
import {
  generateOAuthParams,
  signOAuthState,
  verifyOAuthState,
  resolveOrCreateGoogleUser,
  OAUTH_STATE_COOKIE_NAME,
} from '../../apps/api/src/modules/auth/google.js';
import * as googleAuthModule from '../../apps/api/src/modules/auth/google.js';

describe('Real Google OAuth 2.0 & Session Security Architecture (Phase 6)', () => {
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
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  // ============================================================================
  // 1. CONFIGURATION CHECKS & ERROR HANDLING
  // ============================================================================
  describe('OAuth Configuration Guardrails', () => {
    it('returns HTTP 503 OAUTH_CONFIG_REQUIRED when Google credentials are unconfigured or placeholder', async () => {
      const origId = process.env.GOOGLE_CLIENT_ID;
      const origSecret = process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe('OAUTH_CONFIG_REQUIRED');
        expect(body.error.message).toContain('Google OAuth 2.0 is not configured');
      } finally {
        if (origId) process.env.GOOGLE_CLIENT_ID = origId;
        if (origSecret) process.env.GOOGLE_CLIENT_SECRET = origSecret;
      }
    });
  });

  // ============================================================================
  // 2. OAUTH INITIATION & PKCE / STATE SECURITY
  // ============================================================================
  describe('OAuth Flow Initiation & PKCE Protection', () => {
    it('generates high-entropy state and PKCE verifier/challenge parameters', () => {
      const { state, codeVerifier, codeChallenge } = generateOAuthParams();
      expect(state).toHaveLength(64); // 32 bytes hex
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeChallenge).toBeDefined();
      expect(codeVerifier).not.toBe(codeChallenge);
    });

    it('signs and verifies OAuth state cookie with cryptographic HMAC and expiration', () => {
      const secret = 'test_session_secret_32_characters_minimum';
      const { state, codeVerifier } = generateOAuthParams();
      const signed = signOAuthState({ state, codeVerifier, createdAt: Date.now() }, secret);

      expect(signed).toContain('.');
      const verified = verifyOAuthState(signed, secret);
      expect(verified).not.toBeNull();
      expect(verified?.state).toBe(state);
      expect(verified?.codeVerifier).toBe(codeVerifier);

      // Tampered state signature is rejected
      const tampered = signed.substring(0, signed.length - 4) + '0000';
      expect(verifyOAuthState(tampered, secret)).toBeNull();

      // Expired state (> 10 minutes) is rejected
      const expiredPayload = signOAuthState(
        { state, codeVerifier, createdAt: Date.now() - 11 * 60 * 1000 },
        secret,
      );
      expect(verifyOAuthState(expiredPayload, secret)).toBeNull();
    });

    it('redirects to Google consent screen with PKCE parameters when credentials are configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-value';
      process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3001/api/auth/google/callback';

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
        expect(res.status).toBe(302);

        const location = res.headers.get('location');
        expect(location).toBeDefined();
        expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
        expect(location).toContain('client_id=test-client-id.apps.googleusercontent.com');
        expect(location).toContain('response_type=code');
        expect(location).toContain('code_challenge=');
        expect(location).toContain('code_challenge_method=S256');
        expect(location).toContain('state=');

        // Verify HTTP-only signed state cookie is set
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toBeDefined();
        expect(setCookie).toContain(OAUTH_STATE_COOKIE_NAME);
        expect(setCookie).toContain('HttpOnly');
      } finally {
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;
      }
    });
  });

  // ============================================================================
  // 3. CALLBACK SECURITY & STATE VALIDATION
  // ============================================================================
  describe('Callback State Validation & Tamper Protection', () => {
    it('rejects callback with missing code or state parameter', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/callback`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects callback when state does not match the state cookie (anti-CSRF)', async () => {
      const secret = process.env.SESSION_SECRET || 'reachinbox_default_session_secret_32_chars';
      const { state, codeVerifier } = generateOAuthParams();
      const signedCookie = signOAuthState({ state, codeVerifier, createdAt: Date.now() }, secret);

      const res = await fetch(
        `${baseUrl}/api/auth/google/callback?code=mock_code&state=attacker_manipulated_state`,
        {
          headers: { Cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}` },
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_OAUTH_STATE');
    });

    it('rejects callback when state cookie is missing completely', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=random_state`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_OAUTH_STATE');
    });

    it('redirects to frontend when Google returns an error parameter', async () => {
      const res = await fetch(
        `${baseUrl}/api/auth/google/callback?error=access_denied&error_description=User+denied+consent`,
        { redirect: 'manual' },
      );
      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(decodeURIComponent(location!)).toContain('User denied consent');
    });
  });

  // ============================================================================
  // 4. IDENTITY RESOLUTION & POSTGRESQL PERSISTENCE
  // ============================================================================
  describe('Stable Google Subject Identity Resolution (PostgreSQL)', () => {
    it('persists and resolves Google user by stable `sub` identifier rather than email alone', async () => {
      const stableSub = `google_sub_${Date.now()}_stable`;
      const initialProfile = {
        sub: stableSub,
        email: `alice_${Date.now()}@gmail.com`,
        name: 'Alice Original',
        picture: 'https://lh3.googleusercontent.com/alice.png',
        email_verified: true,
      };

      // 1. Initial resolution creates new user & default sender
      const user1 = await resolveOrCreateGoogleUser(initialProfile);
      expect(user1.id).toBeDefined();
      expect(user1.google_subject).toBe(stableSub);
      expect(user1.email).toBe(initialProfile.email);
      expect(user1.name).toBe('Alice Original');

      // Verify user exists in PostgreSQL
      const dbCheck = await query<{ id: string; google_subject: string }>(
        'SELECT id, google_subject FROM users WHERE id = $1',
        [user1.id],
      );
      expect(dbCheck.rows.length).toBe(1);
      expect(dbCheck.rows[0].google_subject).toBe(stableSub);

      // Verify default sender was created
      const senderCheck = await query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM senders WHERE user_id = $1',
        [user1.id],
      );
      expect(senderCheck.rows.length).toBeGreaterThanOrEqual(1);

      // 2. User changes primary email or display name on Google, but sub remains identical
      const updatedProfile = {
        sub: stableSub,
        email: `alice_updated_${Date.now()}@gmail.com`,
        name: 'Alice Renamed',
        picture: 'https://lh3.googleusercontent.com/alice_new.png',
        email_verified: true,
      };

      const user2 = await resolveOrCreateGoogleUser(updatedProfile);
      expect(user2.id).toBe(user1.id); // Same database primary key!
      expect(user2.google_subject).toBe(stableSub);
      expect(user2.email).toBe(updatedProfile.email);
      expect(user2.name).toBe('Alice Renamed');
    });
  });

  // ============================================================================
  // 5. SERVER-SIDE SESSION MANAGEMENT & TOKEN HASHING
  // ============================================================================
  describe('Server-Side Session Lifecycle & Database Validation', () => {
    it('creates, validates, and hashes session tokens securely in PostgreSQL', async () => {
      // 1. Create a test user in DB
      const userRes = await query<{ id: string }>(
        `INSERT INTO users (google_subject, email, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`sub_session_${Date.now()}`, `user_${Date.now()}@test.com`, 'Session User'],
      );
      const userId = userRes.rows[0].id;

      // 2. Issue session
      const { sessionToken, expiresAt } = await createSession(userId);
      expect(sessionToken).toHaveLength(64); // 32 bytes hex
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

      // Verify DB stores ONLY SHA-256 hash of token, never plaintext token
      const tokenHash = hashSessionToken(sessionToken);
      const sessionRow = await query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM user_sessions WHERE id = $1',
        [tokenHash],
      );
      expect(sessionRow.rows.length).toBe(1);
      expect(sessionRow.rows[0].user_id).toBe(userId);

      // 3. Validate valid session token
      const validatedUser = await validateSession(sessionToken);
      expect(validatedUser).not.toBeNull();
      expect(validatedUser?.id).toBe(userId);

      // 4. Validate non-existent token returns null
      expect(await validateSession('non_existent_token_12345')).toBeNull();

      // 5. Invalidate session
      const invalidated = await invalidateSession(sessionToken);
      expect(invalidated).toBe(true);

      // 6. After invalidation, validateSession returns null
      expect(await validateSession(sessionToken)).toBeNull();
    });
  });

  // ============================================================================
  // 6. PROTECTED ENDPOINTS & USER SCOPING
  // ============================================================================
  describe('Protected Endpoints, User Scoping, and Logout', () => {
    it('GET /api/auth/me returns 401 when no session cookie is provided', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('No active session found');
    });

    it('GET /api/auth/me returns 401 when invalid session token is provided', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=invalid_token_99999` },
      });
      expect(res.status).toBe(401);
    });

    it('GET /api/auth/me returns authenticated user identity with valid session cookie', async () => {
      const userRes = await query<{ id: string; email: string; name: string }>(
        `INSERT INTO users (google_subject, email, name)
         VALUES ($1, $2, $3)
         RETURNING id, email, name`,
        [`sub_me_${Date.now()}`, `me_${Date.now()}@test.com`, 'Me Test User'],
      );
      const user = userRes.rows[0];
      const { sessionToken } = await createSession(user.id);

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { id: string; email: string; name: string } };
      expect(body.user.id).toBe(user.id);
      expect(body.user.email).toBe(user.email);
      expect(body.user.name).toBe(user.name);
    });

    it('POST /api/auth/logout terminates session in PostgreSQL and clears session cookie', async () => {
      const userRes = await query<{ id: string }>(
        `INSERT INTO users (google_subject, email, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`sub_logout_${Date.now()}`, `logout_${Date.now()}@test.com`, 'Logout User'],
      );
      const userId = userRes.rows[0].id;
      const { sessionToken } = await createSession(userId);

      // Verify active session before logout
      const beforeRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      });
      expect(beforeRes.status).toBe(200);

      // Call logout
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      });
      expect(logoutRes.status).toBe(200);
      const setCookie = logoutRes.headers.get('set-cookie');
      expect(setCookie).toBeDefined();

      // Verify session was erased from PostgreSQL
      const tokenHash = hashSessionToken(sessionToken);
      const dbCheck = await query('SELECT id FROM user_sessions WHERE id = $1', [tokenHash]);
      expect(dbCheck.rows.length).toBe(0);

      // Subsequent request with the same session token is rejected with 401
      const afterRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      });
      expect(afterRes.status).toBe(401);
    });

    it('enforces strict cross-tenant isolation: User B cannot access User A senders or emails', async () => {
      // User A
      const userARes = await query<{ id: string }>(
        `INSERT INTO users (google_subject, email, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`sub_a_${Date.now()}`, `usera_${Date.now()}@test.com`, 'User A'],
      );
      const userAId = userARes.rows[0].id;
      const { sessionToken: sessionTokenA } = await createSession(userAId);

      // Sender for User A
      const senderARes = await query<{ id: string }>(
        `INSERT INTO senders (user_id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour)
         VALUES ($1, $2, $3, 'ethereal_default', 2000, 50)
         RETURNING id`,
        [userAId, `sendera_${Date.now()}@test.com`, 'Sender A'],
      );
      const senderAId = senderARes.rows[0].id;

      // User B
      const userBRes = await query<{ id: string }>(
        `INSERT INTO users (google_subject, email, name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`sub_b_${Date.now()}`, `userb_${Date.now()}@test.com`, 'User B'],
      );
      const userBId = userBRes.rows[0].id;
      const { sessionToken: sessionTokenB } = await createSession(userBId);

      // 1. User A lists senders: sees Sender A
      const listSendersA = await fetch(`${baseUrl}/api/senders`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}` },
      });
      expect(listSendersA.status).toBe(200);
      const sendersABody = (await listSendersA.json()) as { senders: Array<{ id: string }> };
      expect(sendersABody.senders.map((s) => s.id)).toContain(senderAId);

      // 2. User B lists senders: does NOT see Sender A
      const listSendersB = await fetch(`${baseUrl}/api/senders`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}` },
      });
      expect(listSendersB.status).toBe(200);
      const sendersBBody = (await listSendersB.json()) as { senders: Array<{ id: string }> };
      const senderIds = sendersBBody.senders.map((s) => s.id);
      expect(senderIds).not.toContain(senderAId);

      // 2. User B attempts to schedule an email using User A's sender_id -> 404 SENDER_NOT_FOUND
      const futureDate = new Date(Date.now() + 600000).toISOString();
      const scheduleRes = await fetch(`${baseUrl}/api/emails/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}`,
        },
        body: JSON.stringify({
          sender_id: senderAId, // Belongs to User A!
          recipient_email: 'target@example.com',
          subject: 'Unauthorized Probe',
          body: 'Attempting cross-tenant access',
          scheduled_at: futureDate,
        }),
      });

      expect(scheduleRes.status).toBe(404);
      const scheduleError = (await scheduleRes.json()) as { error: { code: string } };
      expect(scheduleError.error.code).toBe('SENDER_NOT_FOUND');
    });
  });

  // ============================================================================
  // 7. END-TO-END CALLBACK FLOW (MOCKING GOOGLE ENDPOINTS FOR AUTOMATED CI)
  // [Unit/Mocked Test - Clearly labeled as mocking Google per requirement]
  // ============================================================================
  describe('[Mocked External Google Endpoints] OAuth Callback Token Exchange Simulation', () => {
    it('exchanges code, resolves identity in PostgreSQL, sets session cookie, and redirects to dashboard', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-value';

      const mockGoogleSub = `ci_mock_sub_${Date.now()}`;
      const mockProfile = {
        sub: mockGoogleSub,
        email: `ci_google_user_${Date.now()}@gmail.com`,
        name: 'CI Google User',
        picture: 'https://lh3.googleusercontent.com/ci_avatar.png',
        email_verified: true,
      };

      // Spy on exchangeCodeForGoogleProfile to simulate Google returning verified identity
      const spy = vi
        .spyOn(googleAuthModule, 'exchangeCodeForGoogleProfile')
        .mockResolvedValueOnce(mockProfile);

      try {
        const secret = process.env.SESSION_SECRET || 'reachinbox_default_session_secret_32_chars';
        const { state, codeVerifier } = generateOAuthParams();
        const signedCookie = signOAuthState({ state, codeVerifier, createdAt: Date.now() }, secret);

        const res = await fetch(
          `${baseUrl}/api/auth/google/callback?code=mock_valid_auth_code&state=${state}`,
          {
            redirect: 'manual',
            headers: { Cookie: `${OAUTH_STATE_COOKIE_NAME}=${signedCookie}` },
          },
        );

        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toContain('http://localhost:5173');

        // Verify session cookie was set
        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toBeDefined();
        expect(setCookie).toContain(SESSION_COOKIE_NAME);
        expect(setCookie).toContain('HttpOnly');

        // Extract session token from Set-Cookie header
        const match = setCookie?.match(/reachinbox_session=([^;]+)/);
        expect(match).not.toBeNull();
        const sessionToken = match![1];

        // Verify that the user now exists in PostgreSQL
        const dbUser = await query<{ id: string; email: string; google_subject: string }>(
          'SELECT id, email, google_subject FROM users WHERE google_subject = $1',
          [mockGoogleSub],
        );
        expect(dbUser.rows.length).toBe(1);
        expect(dbUser.rows[0].email).toBe(mockProfile.email);

        // Verify that the session is valid in PostgreSQL
        const validated = await validateSession(sessionToken);
        expect(validated).not.toBeNull();
        expect(validated?.id).toBe(dbUser.rows[0].id);

        // Test calling protected /api/auth/me with the issued session cookie
        const meRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
        });
        expect(meRes.status).toBe(200);
        const meBody = (await meRes.json()) as { user: { google_subject: string; email: string } };
        expect(meBody.user.google_subject).toBe(mockGoogleSub);
        expect(meBody.user.email).toBe(mockProfile.email);
      } finally {
        spy.mockRestore();
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;
      }
    });
  });
});
