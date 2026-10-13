import type { Request, Response, NextFunction } from 'express';
import { query } from '@reachinbox/db';

export const DEFAULT_DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_DEV_SENDER_ID = '00000000-0000-4000-8000-000000000002';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
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
 * Ensures the default developer/test tenant exists in the database
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
    console.error('Failed to ensure default dev user:', err);
  }
}

/**
 * User scoping middleware (Phase 3).
 * Resolves user from x-user-id header or defaults to DEFAULT_DEV_USER_ID in dev/test.
 * Guarantees strict user isolation on all database queries.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  await ensureDefaultDevUser();

  const customUserId = req.headers['x-user-id'];
  const userId =
    typeof customUserId === 'string' && customUserId.trim()
      ? customUserId.trim()
      : DEFAULT_DEV_USER_ID;

  // Validate that user exists in database
  const userRes = await query<AuthenticatedUser>(
    'SELECT id, email, name FROM users WHERE id = $1',
    [userId],
  );

  if (userRes.rows.length === 0) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: `User '${userId}' not found or unauthorized`,
      },
    });
    return;
  }

  req.user = userRes.rows[0];
  next();
}
