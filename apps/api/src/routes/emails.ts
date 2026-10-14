import { Router, type Request, type Response } from 'express';
import { query } from '@reachinbox/db';
import { scheduleEmailSchema } from '@reachinbox/shared';
import { requireUser } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { handleIdempotency } from '../middleware/idempotency.js';
import {
  scheduleEmails,
  listScheduledEmails,
  listSentEmails,
  getEmailById,
} from '../services/email.js';
import { searchEmails } from '../services/elasticsearch.js';
import { reconcilePendingOutbox } from '../services/reconciliation.js';

export const emailRouter = Router();

/**
 * POST /api/emails/schedule
 * Schedules a single or batch email request with persistence and BullMQ delayed enqueue (BE-01, BE-02, BE-03, BE-08)
 */
emailRouter.post(
  '/api/emails/schedule',
  requireUser,
  validateBody(scheduleEmailSchema),
  handleIdempotency,
  async (req: Request, res: Response): Promise<void> => {
    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey)
      ? rawKey[0].trim()
      : rawKey
        ? rawKey.trim()
        : undefined;

    const reqWithHash = req as unknown as { idempotencyHash?: string };
    const idempotencyHash = reqWithHash.idempotencyHash;

    try {
      const result = await scheduleEmails(req.user!.id, req.body, idempotencyKey, idempotencyHash);
      res.status(201).json(result);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === '23505' && idempotencyKey) {
        // Concurrent duplicate caught by DB unique constraint.
        // Wait for winner to finish and retrieve stored response.
        for (let attempt = 0; attempt < 25; attempt++) {
          await new Promise((r) => setTimeout(r, 40));
          const cached = await query<{
            request_hash: string;
            response_status: number;
            response_body: unknown;
          }>(
            `SELECT request_hash, response_status, response_body FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2`,
            [req.user!.id, idempotencyKey],
          );
          if (cached.rows.length > 0) {
            if (idempotencyHash && cached.rows[0].request_hash !== idempotencyHash) {
              res.status(409).json({
                error: {
                  code: 'IDEMPOTENCY_CONFLICT',
                  message: 'Idempotency key was previously used with a different request payload',
                },
              });
              return;
            }

            res.setHeader('Idempotency-Replayed', 'true');
            const cachedBody =
              typeof cached.rows[0].response_body === 'string'
                ? JSON.parse(cached.rows[0].response_body as string)
                : cached.rows[0].response_body;
            res.status(cached.rows[0].response_status).json(cachedBody);
            return;
          }
        }
      }

      if (error.code === 'SENDER_NOT_FOUND') {
        res.status(404).json({
          error: {
            code: 'SENDER_NOT_FOUND',
            message: error.message || 'Sender not found for authenticated user',
          },
        });
        return;
      }

      if (error.code === 'INVALID_RECIPIENTS') {
        res.status(400).json({
          error: {
            code: 'INVALID_RECIPIENTS',
            message: error.message || 'No valid recipient email addresses found',
          },
        });
        return;
      }

      console.error('Unhandled error scheduling email:', err);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while scheduling email',
        },
      });
    }
  },
);

/**
 * GET /api/emails/scheduled
 * Lists scheduled emails with pagination and optional sender filtering (BE-14)
 */
emailRouter.get(
  '/api/emails/scheduled',
  requireUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const senderId = req.query.sender_id as string | undefined;

      const result = await listScheduledEmails(req.user!.id, { page, limit, senderId });
      res.status(200).json(result);
    } catch (err) {
      console.error('Error listing scheduled emails:', err);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve scheduled emails',
        },
      });
    }
  },
);

/**
 * GET /api/emails/sent
 * Lists sent and failed emails with pagination and status filtering (BE-14)
 */
emailRouter.get(
  '/api/emails/sent',
  requireUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as string | undefined;
      const senderId = req.query.sender_id as string | undefined;

      const result = await listSentEmails(req.user!.id, { page, limit, status, senderId });
      res.status(200).json(result);
    } catch (err) {
      console.error('Error listing sent emails:', err);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve sent emails',
        },
      });
    }
  },
);

/**
 * GET /api/emails/search and GET /api/search/emails
 * User-scoped full-text search against Elasticsearch (with PostgreSQL fallback)
 */
emailRouter.get(
  ['/api/emails/search', '/api/search/emails'],
  requireUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const q = (req.query.q || req.query.query) as string | undefined;
      const status = req.query.status as string | undefined;
      const senderId = req.query.sender_id as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await searchEmails(req.user!.id, {
        query: q,
        status,
        sender_id: senderId,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      console.error('Error executing email search:', err);
      res.status(500).json({
        error: {
          code: 'SEARCH_ERROR',
          message: 'Failed to execute search query',
        },
      });
    }
  },
);

/**
 * GET /api/emails/:id
 * Retrieves a single email record with tenant isolation check (BE-14)
 */
emailRouter.get(
  '/api/emails/:id',
  requireUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const emailId = req.params.id as string;
      const email = await getEmailById(req.user!.id, emailId);
      if (!email) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: `Email with id '${emailId}' not found`,
          },
        });
        return;
      }

      res.status(200).json({ email });
    } catch (err) {
      console.error('Error retrieving email by id:', err);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve email',
        },
      });
    }
  },
);

/**
 * POST /api/emails/reconcile
 * Triggerable outbox recovery endpoint to enqueue any stranded outbox events (BE-10)
 */
emailRouter.post(
  '/api/emails/reconcile',
  requireUser,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await reconcilePendingOutbox();
      res.status(200).json({
        status: 'ok',
        reconciliation: result,
      });
    } catch (err) {
      console.error('Error reconciling outbox:', err);
      res.status(500).json({
        error: {
          code: 'RECONCILIATION_ERROR',
          message: 'Failed to reconcile pending outbox records',
        },
      });
    }
  },
);
