import express, { type Express } from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';

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

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  return app;
}
