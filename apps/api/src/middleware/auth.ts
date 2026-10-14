import type { Request, Response, NextFunction } from 'express';
import { query } from '@reachinbox/db';
import {
  validateSession,
  createSession,
  SESSION_COOKIE_NAME,
} from '../modules/auth/session.js';

export const DEFAULT_DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_DEV_SENDER_ID = '00000000-0000-4000-8000-000000000002';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  google_subject?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

let devUserInitialized = false;

/**
 * Ensures the default developer/test tenant fixtures exist in the test database for worker/queue tests.
 */
export async function ensureDefaultDevUser(): Promise<void> {
  if (devUserInitialized) return;
  try {
    await query(
      `INSERT INTO users (id, google_subject, email, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;`,
      [
        DEFAULT_DEV_USER_ID,
        'dev_google_subject_default',
        'developer@reachinbox.test',
        'Developer User',
      ],
    );

    await query(
      `INSERT INTO senders (id, user_id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email;`,
      [
        DEFAULT_DEV_SENDER_ID,
        DEFAULT_DEV_USER_ID,
        'sender@reachinbox.test',
        'ReachInbox Default Sender',
        'ethereal_default',
        2000,
        50,
      ],
    );
    devUserInitialized = true;
  } catch (err) {
    console.error('Failed to ensure default dev user fixtures:', err);
  }
}

/**
 * Extracts session token from HTTP-only cookie or Authorization Bearer header.
 */
function extractSessionToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Real session and authorization middleware (Phase 6).
 * Enforces strict authentication via PostgreSQL-persisted user_sessions.
 * Rejects unauthenticated requests with HTTP 401 Unauthorized.
 * Prohibits fake fallback IDs or client-controlled user identification headers.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionToken = extractSessionToken(req);

  if (!sessionToken) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. No active session found.',
      },
    });
    return;
  }

  try {
    const user = await validateSession(sessionToken);

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session. Please sign in again.',
        },
      });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Session validation error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to validate authentication session',
      },
    });
  }
}

/**
 * CSRF Protection middleware for session-authenticated endpoints.
 * Validates browser Origin header against allowed frontend/API origins on state-changing requests.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser request or direct server request
    return next();
  }

  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    process.env.API_BASE_URL || 'http://localhost:3001',
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : []),
  ];

  const isAllowed = allowedOrigins.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      const originUrl = new URL(origin);
      return allowedUrl.origin === originUrl.origin;
    } catch {
      return false;
    }
  });

  if (!isAllowed) {
    res.status(403).json({
      error: {
        code: 'CSRF_DETECTED',
        message: `Cross-site request forgery protection blocked request from origin: ${origin}`,
      },
    });
    return;
  }

  next();
}

/**
 * Test helper: Creates a real user and real database session in PostgreSQL for automated test suites.
 */
export async function createTestUserAndSession(options?: {
  email?: string;
  name?: string;
  googleSubject?: string;
}): Promise<{ user: AuthenticatedUser; sessionToken: string; cookieHeader: string }> {
  const googleSubject = options?.googleSubject || `test_sub_${Date.now()}_${Math.random()}`;
  const email = options?.email || `test_${Date.now()}@reachinbox.test`;
  const name = options?.name || 'Test User';

  const userRes = await query<AuthenticatedUser>(
    `INSERT INTO users (google_subject, email, name, avatar_url)
     VALUES ($1, $2, $3, null)
     RETURNING id, google_subject, email, name, avatar_url`,
    [googleSubject, email, name],
  );

  const user = userRes.rows[0];

  // Create default sender for this user
  await query(
    `INSERT INTO senders (user_id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour)
     VALUES ($1, $2, $3, 'ethereal_default', 2000, 50)`,
    [user.id, user.email, user.name],
  );

  const { sessionToken } = await createSession(user.id);
  const cookieHeader = `${SESSION_COOKIE_NAME}=${sessionToken}`;

  return { user, sessionToken, cookieHeader };
}
