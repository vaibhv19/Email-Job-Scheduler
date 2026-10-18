import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getEmailQueue } from '@email-scheduler/redis';
import type { Request, Response, NextFunction, Router } from 'express';

/**
 * Basic authentication middleware to protect Bull Board (OPS-03).
 */
export function createBullBoardAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).send('Authentication required');
    }

    const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
    const colonIndex = credentials.indexOf(':');
    if (colonIndex === -1) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).send('Authentication required');
    }

    const username = credentials.substring(0, colonIndex);
    const password = credentials.substring(colonIndex + 1);

    const expectedUser = process.env.BULL_BOARD_USERNAME || 'admin';
    const expectedPass = process.env.BULL_BOARD_PASSWORD || 'admin';

    if (username !== expectedUser || password !== expectedPass) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).send('Invalid credentials');
    }

    return next();
  };
}

/**
 * Configures and mounts Bull Board dashboard adapter for BullMQ queues (OPS-01..OPS-03).
 */
export function setupBullBoard(basePath = process.env.BULL_BOARD_PATH || '/admin/queues'): {
  router: Router;
  authMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  basePath: string;
} {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);

  try {
    const queue = getEmailQueue();
    createBullBoard({
      queues: [new BullMQAdapter(queue)],
      serverAdapter,
    });
  } catch (err) {
    console.warn('[BullBoard] Note: Unable to initialize queue for Bull Board at setup:', err);
  }

  return {
    router: serverAdapter.getRouter(),
    authMiddleware: createBullBoardAuthMiddleware(),
    basePath,
  };
}
