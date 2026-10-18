import crypto from 'crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { query } from '@email-scheduler/db';
import type { AuthenticatedUser } from '../../middleware/auth.js';

export const OAUTH_STATE_COOKIE_NAME = 'scheduler_oauth_state';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

/**
 * Validates whether Google OAuth credentials are provided and non-placeholder.
 */
export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_CALLBACK_URL?.trim() || 'http://localhost:3001/api/auth/google/callback';

  const isConfigured = Boolean(
    clientId &&
      clientSecret &&
      !clientId.startsWith('your_') &&
      !clientSecret.startsWith('your_') &&
      !clientId.startsWith('replace_') &&
      !clientSecret.startsWith('replace_'),
  );

  return { clientId, clientSecret, redirectUri, isConfigured };
}

/**
 * Creates an instance of Google's official OAuth2Client.
 */
export function createGoogleOAuth2Client(): OAuth2Client {
  const { clientId, clientSecret, redirectUri, isConfigured } = getGoogleOAuthConfig();
  if (!isConfigured || !clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured.');
  }

  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
  });
}

/**
 * Generates high-entropy OAuth state and PKCE verifier/challenge pair.
 */
export function generateOAuthParams(): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return { state, codeVerifier, codeChallenge };
}

/**
 * HMAC-signs the OAuth state payload for the short-lived HTTP-only cookie.
 */
export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const data = JSON.stringify(payload);
  const dataB64 = Buffer.from(data, 'utf-8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(dataB64).digest('hex');
  return `${dataB64}.${signature}`;
}

/**
 * Verifies the signed OAuth state cookie and enforces expiration.
 */
export function verifyOAuthState(cookieVal: string, secret: string): OAuthStatePayload | null {
  if (!cookieVal || typeof cookieVal !== 'string' || !cookieVal.includes('.')) {
    return null;
  }

  const [dataB64, signature] = cookieVal.split('.');
  if (!dataB64 || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', secret).update(dataB64).digest('hex');
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const json = Buffer.from(dataB64, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as OAuthStatePayload;

    if (!parsed.state || !parsed.codeVerifier || !parsed.createdAt) {
      return null;
    }

    if (Date.now() - parsed.createdAt > OAUTH_STATE_TTL_MS) {
      return null; // Expired
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Builds Google's real consent/authorization screen URL with PKCE parameters.
 */
export function buildGoogleAuthUrl(
  client: OAuth2Client,
  state: string,
  codeChallenge: string,
): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    prompt: 'consent',
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
  });
}

/**
 * Exchanges authorization code with Google for tokens and retrieves verified Google profile.
 * Authenticates against Google's actual endpoints:
 * - Token Exchange: https://oauth2.googleapis.com/token
 * - User Info: https://www.googleapis.com/oauth2/v3/userinfo
 */
export async function exchangeCodeForGoogleProfile(
  client: OAuth2Client,
  code: string,
  codeVerifier: string,
): Promise<GoogleProfile> {
  // Exchange code for tokens with PKCE code_verifier
  const { tokens } = await client.getToken({
    code,
    codeVerifier,
  });

  client.setCredentials(tokens);

  // Retrieve verified identity from Google userinfo endpoint
  const userinfoRes = await client.request<{
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  }>({
    url: 'https://www.googleapis.com/oauth2/v3/userinfo',
  });

  const data = userinfoRes.data;
  if (!data || !data.sub || typeof data.sub !== 'string') {
    throw new Error('Google identity validation failed: sub identifier is missing or invalid.');
  }

  if (!data.email) {
    throw new Error('Google identity validation failed: email address is missing.');
  }

  return {
    sub: data.sub,
    email: data.email,
    name: data.name || data.email.split('@')[0],
    picture: data.picture,
    email_verified: data.email_verified,
  };
}

/**
 * Resolves or creates a user in PostgreSQL using Google's stable `sub` as the identity key.
 * Ensures a default sender exists for the user.
 */
export async function resolveOrCreateGoogleUser(profile: GoogleProfile): Promise<AuthenticatedUser> {
  // 1. Upsert user keyed on google_subject (stable Google ID)
  const userRes = await query<AuthenticatedUser>(
    `INSERT INTO users (google_subject, email, name, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (google_subject) DO UPDATE
     SET email = EXCLUDED.email,
         name = EXCLUDED.name,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = NOW()
     RETURNING id, google_subject, email, name, avatar_url`,
    [profile.sub, profile.email, profile.name, profile.picture || null],
  );

  const user = userRes.rows[0];

  // 2. Ensure default sender exists for this user in PostgreSQL
  await query(
    `INSERT INTO senders (user_id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour)
     VALUES ($1, $2, $3, 'ethereal_default', 2000, 50)
     ON CONFLICT (user_id, email) DO NOTHING`,
    [user.id, user.email, user.name || 'Primary Sender'],
  );

  return user;
}
