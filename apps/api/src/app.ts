import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { emailRouter } from './routes/emails.js';

export function createApp(): Express {
  const app = express();

  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
  app.use(
    cors({
      origin: corsOrigin.includes(',') ? corsOrigin.split(',').map((s) => s.trim()) : corsOrigin,
      credentials: true,
    }),
  );

  app.use(express.json());

  // Mount health check endpoints at root level (/health, /ready)
  app.use(healthRouter);

  // Mount email scheduling and listing endpoints
  app.use(emailRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Global Error Handler (BE-17)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API exception:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: (err as Error)?.message || 'An unexpected internal server error occurred',
      },
    });
  });

  return app;
}
