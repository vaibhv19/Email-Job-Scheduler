import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';

/**
 * Validates request body using a Zod schema and outputs standard ApiErrorEnvelope (BE-04, BE-17)
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));

        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: issues[0]?.message || 'Invalid request payload',
            details: issues,
          },
        });
        return;
      }

      next(err);
    }
  };
}
