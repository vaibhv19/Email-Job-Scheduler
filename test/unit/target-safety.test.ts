import { describe, it, expect } from 'vitest';
import { resolveDatabaseConfig } from '@reachinbox/db';
import { resolveRedisOptions, verifyRedisTestIsolation } from '@reachinbox/redis';

describe('Configuration Precedence and Test Target Safety (QA-16)', () => {
  it('DATABASE_URL takes precedence over individual DB_* parameters', () => {
    const originalUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = 'postgresql://user:pass@testhost:5432/custom_db';
      const config = resolveDatabaseConfig();
      expect(config.connectionString).toBe('postgresql://user:pass@testhost:5432/custom_db');
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it('REDIS_URL takes precedence over individual REDIS_* parameters', () => {
    const originalUrl = process.env.REDIS_URL;
    try {
      process.env.REDIS_URL = 'redis://customhost:6380/15';
      const resolved = resolveRedisOptions();
      expect(resolved.url).toBe('redis://customhost:6380/15');
    } finally {
      process.env.REDIS_URL = originalUrl;
    }
  });

  it('verifyRedisTestIsolation rejects Redis database 0 for destructive operations', async () => {
    const originalUrl = process.env.REDIS_URL;
    try {
      process.env.REDIS_URL = 'redis://localhost:6380/0';
      const result = await verifyRedisTestIsolation();
      expect(result.safe).toBe(false);
      expect(result.dbIndex).toBe(0);
      expect(result.reason).toContain('Safety violation');
    } finally {
      process.env.REDIS_URL = originalUrl;
    }
  });

  it('verifyRedisTestIsolation accepts isolated Redis database index >= 1', async () => {
    const originalUrl = process.env.REDIS_URL;
    try {
      process.env.REDIS_URL = 'redis://localhost:6380/15';
      const result = await verifyRedisTestIsolation();
      expect(result.safe).toBe(true);
      expect(result.dbIndex).toBe(15);
    } finally {
      process.env.REDIS_URL = originalUrl;
    }
  });
});
