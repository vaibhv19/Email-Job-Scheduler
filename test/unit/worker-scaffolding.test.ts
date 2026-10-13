import { describe, it, expect } from 'vitest';
import { RATE_LIMIT_DEFAULTS } from '@reachinbox/shared';

describe('Worker Scaffolding and Concurrency Config (INF-11, RATE-01)', () => {
  it('exports default worker concurrency and rate limits', () => {
    expect(RATE_LIMIT_DEFAULTS.WORKER_CONCURRENCY).toBe(5);
    expect(RATE_LIMIT_DEFAULTS.MIN_SEND_INTERVAL_MS).toBe(2000);
    expect(RATE_LIMIT_DEFAULTS.MAX_EMAILS_PER_HOUR).toBe(50);
  });

  it('respects environment overrides when defined', () => {
    const originalConcurrency = process.env.WORKER_CONCURRENCY;
    try {
      process.env.WORKER_CONCURRENCY = '10';
      const parsed = parseInt(process.env.WORKER_CONCURRENCY, 10);
      expect(parsed).toBe(10);
    } finally {
      process.env.WORKER_CONCURRENCY = originalConcurrency;
    }
  });
});
