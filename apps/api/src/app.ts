import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { csrfProtection } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { sendersRouter } from './routes/senders.js';
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

  app.use(cookieParser());
  app.use(express.json());
  app.use(csrfProtection);

  // Mount health check endpoints at root level (/health, /ready)
  app.use(healthRouter);

  // Mount authentication routes (/api/auth/google, /api/auth/google/callback, /api/auth/me, /api/auth/logout)
  app.use(authRouter);

  // Mount senders routes (/api/senders)
  app.use(sendersRouter);

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
