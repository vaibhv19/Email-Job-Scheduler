import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '@reachinbox/db';

export function computePayloadHash(req: Request): string {
  const normalizedPayload = req.body ? JSON.stringify(req.body) : '';
  const data = `${req.method}:${req.baseUrl}${req.path}:${normalizedPayload}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Idempotency Middleware (BE-08, QA-04)
 * Guarantees duplicate submissions with the same key and payload receive identical responses,
 * while payload mismatches return 409 Conflict.
 */
export async function handleIdempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.headers['idempotency-key'];
  if (!rawKey) {
    // Idempotency key is optional; proceed normally
    return next();
  }

  const idempotencyKey = Array.isArray(rawKey) ? rawKey[0].trim() : rawKey.trim();

  if (!idempotencyKey || idempotencyKey.length > 255) {
    res.status(400).json({
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be a non-empty string with maximum length of 255 characters',
      },
    });
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    return next();
  }

  const currentHash = computePayloadHash(req);
  (req as unknown as { idempotencyHash?: string }).idempotencyHash = currentHash;

  try {
    // 1. Check existing idempotency record
    const existing = await query<{
      request_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_status, response_body
       FROM idempotency_records
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );

    if (existing.rows.length > 0) {
      const record = existing.rows[0];
      if (record.request_hash === currentHash) {
        // Replay cached response
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(record.response_status).json(record.response_body);
        return;
      }

      // Payload mismatch with same idempotency key -> 409 Conflict
      res.status(409).json({
        error: {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Idempotency key was previously used with a different request payload',
        },
      });
      return;
    }

    // 2. Intercept response to store successful outcome
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown): Response {
      // Restore original method
      res.json = originalJson;

      // Only store 2xx successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        query(
          `INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, response_status, response_body)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, idempotency_key) DO NOTHING;`,
          [userId, idempotencyKey, currentHash, res.statusCode, JSON.stringify(body)],
        ).catch((err) => {
          console.error('Failed to store idempotency record:', err);
        });
      }

      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
}
