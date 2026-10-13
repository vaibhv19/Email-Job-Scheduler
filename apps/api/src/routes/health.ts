import { Router, type Request, type Response } from 'express';
import { checkDatabaseHealth } from '@reachinbox/db';
import { checkRedisHealth } from '@reachinbox/redis';

export const healthRouter = Router();

/**
 * GET /health
 * Liveness probe: returns 200 OK as long as the process is alive.
 */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Probes Elasticsearch cluster health using native fetch
 */
async function checkElasticsearchHealth(): Promise<boolean> {
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${esUrl}/_cluster/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return false;
    const data = (await response.json()) as { status?: string };
    return data.status === 'green' || data.status === 'yellow';
  } catch {
    return false;
  }
}

/**
 * GET /ready
 * Readiness probe: checks PostgreSQL, Redis, and Elasticsearch connectivity.
 * Returns 200 if all dependencies are ready, or 503 if any dependency fails.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [dbOk, redisOk, esOk] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkElasticsearchHealth(),
  ]);

  const allReady = dbOk && redisOk && esOk;
  const statusCode = allReady ? 200 : 503;

  res.status(statusCode).json({
    status: allReady ? 'ready' : 'not_ready',
    checks: {
      database: dbOk ? 'ok' : 'unreachable',
      redis: redisOk ? 'ok' : 'unreachable',
      elasticsearch: esOk ? 'ok' : 'unreachable',
    },
    timestamp: new Date().toISOString(),
  });
});
