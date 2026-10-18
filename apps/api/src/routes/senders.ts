import { Router, type Request, type Response } from 'express';
import { query } from '@email-scheduler/db';
import { requireUser } from '../middleware/auth.js';

export const sendersRouter = Router();

/**
 * GET /api/senders
 * Lists senders owned exclusively by the authenticated user.
 */
sendersRouter.get('/api/senders', requireUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, email, display_name, min_send_interval_ms, max_emails_per_hour, created_at
       FROM senders
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [req.user!.id],
    );
    res.status(200).json({ senders: result.rows });
  } catch (err) {
    console.error('Failed to list senders:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve senders',
      },
    });
  }
});
