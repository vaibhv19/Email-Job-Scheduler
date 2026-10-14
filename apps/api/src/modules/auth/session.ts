import crypto from 'crypto';
import { query } from '@reachinbox/db';
import type { AuthenticatedUser } from '../../middleware/auth.js';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'reachinbox_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface UserSession {
  id: string; // Token hash
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  lastAccessedAt: Date;
}

/**
 * Hashes a plaintext session token using SHA-256 for secure database persistence.
 * Protects against database leaks by never storing plaintext session tokens.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a cryptographically random session token, hashes it, and stores the session in PostgreSQL.
 * Returns the unhashed token to be placed into the HTTP-only cookie.
 */
export async function createSession(userId: string): Promise<{ sessionToken: string; expiresAt: Date }> {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query(
    `INSERT INTO user_sessions (id, user_id, expires_at, created_at, last_accessed_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [tokenHash, userId, expiresAt],
  );

  return { sessionToken, expiresAt };
}

/**
 * Validates a session token against PostgreSQL user_sessions.
 * Returns the full AuthenticatedUser profile if session is valid and not expired, null otherwise.
 */
export async function validateSession(sessionToken: string): Promise<AuthenticatedUser | null> {
  if (!sessionToken || typeof sessionToken !== 'string') {
    return null;
  }

  const tokenHash = hashSessionToken(sessionToken);

  const res = await query<AuthenticatedUser & { expires_at: Date }>(
    `SELECT u.id, u.google_subject, u.email, u.name, u.avatar_url, s.expires_at
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [tokenHash],
  );

  if (res.rows.length === 0) {
    return null;
  }

  // Asynchronously update last_accessed_at (non-blocking)
  query('UPDATE user_sessions SET last_accessed_at = NOW() WHERE id = $1', [tokenHash]).catch(
    (err) => console.error('Failed to update session last_accessed_at:', err),
  );

  const row = res.rows[0];
  return {
    id: row.id,
    google_subject: row.google_subject,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
  };
}

/**
 * Invalidates a specific session by removing it from PostgreSQL.
 */
export async function invalidateSession(sessionToken: string): Promise<boolean> {
  if (!sessionToken) return false;
  const tokenHash = hashSessionToken(sessionToken);
  const res = await query('DELETE FROM user_sessions WHERE id = $1', [tokenHash]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Invalidates all sessions for a user (e.g. on password reset or global security revoke).
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
}

/**
 * Cookie options for setting and clearing session cookies.
 */
export function getSessionCookieOptions() {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const sameSite = (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax';

  return {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

export function getClearCookieOptions() {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const sameSite = (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax';

  return {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: '/',
  };
}
