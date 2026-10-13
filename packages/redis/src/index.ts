import { Redis, type RedisOptions } from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';

// Attempt to load .env from workspace root if REDIS_URL is not set
if (!process.env.REDIS_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

export function resolveRedisOptions(): { url?: string; options: RedisOptions } {
  const baseOptions: RedisOptions = {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  };

  // Canonical precedence: REDIS_URL takes priority
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      options: baseOptions,
    };
  }

  return {
    options: {
      ...baseOptions,
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6380,
      password: process.env.REDIS_PASSWORD || undefined,
      db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : 0,
    },
  };
}

let globalRedis: Redis | null = null;

export function getRedisClient(overrideOptions?: RedisOptions): Redis {
  if (overrideOptions) {
    return new Redis(overrideOptions);
  }

  if (!globalRedis) {
    const { url, options } = resolveRedisOptions();
    globalRedis = url ? new Redis(url, options) : new Redis(options);

    globalRedis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });
  }

  return globalRedis;
}

export async function closeRedis(): Promise<void> {
  if (globalRedis) {
    await globalRedis.quit();
    globalRedis = null;
  }
}

/**
 * Health check probe: returns true if Redis responds with PONG
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const res = await client.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Validates that destructive test operations (such as test flush or key delete)
 * only execute against an isolated test database index, and never against DB 0 or shared instances.
 */
export async function verifyRedisTestIsolation(): Promise<{
  safe: boolean;
  dbIndex: number;
  reason?: string;
}> {
  const { url, options } = resolveRedisOptions();
  let dbIndex = 0;

  if (url) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace('/', '');
      if (pathname) {
        dbIndex = parseInt(pathname, 10);
      }
    } catch {
      // fallback
    }
  } else if (options.db !== undefined) {
    dbIndex = options.db;
  }

  if (dbIndex === 0) {
    return {
      safe: false,
      dbIndex,
      reason: 'Safety violation: Test operations must not target Redis database 0. Use DB >= 1.',
    };
  }

  return { safe: true, dbIndex };
}
