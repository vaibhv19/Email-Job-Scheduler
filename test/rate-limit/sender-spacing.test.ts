import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  getRedisClient,
  closeRedis,
  reserveRateLimitSlot,
  resetSenderRateLimits,
} from '@reachinbox/redis';

describe('Distributed Rate Limiting: Minimum Delay & Sender Spacing (RATE-02, RATE-03, RATE-06)', () => {
  let redisClient: ReturnType<typeof getRedisClient>;
  const senderA = crypto.randomUUID();
  const senderB = crypto.randomUUID();

  beforeAll(async () => {
    redisClient = getRedisClient();
    await Promise.all([
      resetSenderRateLimits(redisClient, senderA),
      resetSenderRateLimits(redisClient, senderB),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      resetSenderRateLimits(redisClient, senderA),
      resetSenderRateLimits(redisClient, senderB),
    ]);
    await closeRedis();
  });

  it('enforces minimum delay between consecutive sends for the same sender (RATE-02)', async () => {
    const minDelayMs = 2000;
    const now = 100000;

    // Send 1 at now: should be allowed immediately
    const res1 = await reserveRateLimitSlot(redisClient, {
      senderId: senderA,
      emailId: 'email-spacing-1',
      minSendIntervalMs: minDelayMs,
      maxEmailsPerHour: 100,
      now,
    });
    expect(res1.status).toBe('allowed');

    // Send 2 at now + 500ms (500ms < 2000ms): should be rate_limited
    const res2 = await reserveRateLimitSlot(redisClient, {
      senderId: senderA,
      emailId: 'email-spacing-2',
      minSendIntervalMs: minDelayMs,
      maxEmailsPerHour: 100,
      now: now + 500,
    });

    expect(res2.status).toBe('rate_limited');
    if (res2.status === 'rate_limited') {
      expect(res2.waitMs).toBe(1500); // 2000 - 500 = 1500
      expect(res2.nextEligibleTime).toBe(now + minDelayMs); // 100000 + 2000 = 102000
    }

    // Send 3 after minimum delay has elapsed (now + 2001ms): should be allowed
    const res3 = await reserveRateLimitSlot(redisClient, {
      senderId: senderA,
      emailId: 'email-spacing-3',
      minSendIntervalMs: minDelayMs,
      maxEmailsPerHour: 100,
      now: now + 2001,
    });
    expect(res3.status).toBe('allowed');
  });

  it('strictly maintains minimum delay across multiple concurrent workers (RATE-03)', async () => {
    const minDelayMs = 1500;
    const concurrentSender = crypto.randomUUID();
    const now = 200000;

    // Simulate 3 parallel worker instances trying to send for the exact same sender at the exact same millisecond
    const workerAttempts = await Promise.all([
      reserveRateLimitSlot(redisClient, {
        senderId: concurrentSender,
        emailId: 'worker-1-email',
        minSendIntervalMs: minDelayMs,
        maxEmailsPerHour: 100,
        now,
      }),
      reserveRateLimitSlot(redisClient, {
        senderId: concurrentSender,
        emailId: 'worker-2-email',
        minSendIntervalMs: minDelayMs,
        maxEmailsPerHour: 100,
        now,
      }),
      reserveRateLimitSlot(redisClient, {
        senderId: concurrentSender,
        emailId: 'worker-3-email',
        minSendIntervalMs: minDelayMs,
        maxEmailsPerHour: 100,
        now,
      }),
    ]);

    const allowed = workerAttempts.filter((r) => r.status === 'allowed');
    const rateLimited = workerAttempts.filter((r) => r.status === 'rate_limited');

    // Exactly one worker must be granted immediate send; remaining two must be deferred
    expect(allowed.length).toBe(1);
    expect(rateLimited.length).toBe(2);

    for (const r of rateLimited) {
      if (r.status === 'rate_limited') {
        expect(r.nextEligibleTime).toBe(now + minDelayMs);
      }
    }
  });

  it('guarantees per-sender isolation: Sender A hitting limit does not throttle Sender B (RATE-06)', async () => {
    const minDelayMs = 3000;
    const now = 300000;

    // Sender A sends an email
    const resA1 = await reserveRateLimitSlot(redisClient, {
      senderId: senderA,
      emailId: 'sender-a-email-1',
      minSendIntervalMs: minDelayMs,
      maxEmailsPerHour: 10,
      now,
    });
    expect(resA1.status).toBe('allowed');

    // Sender A immediately attempts another send -> rate limited
    const resA2 = await reserveRateLimitSlot(redisClient, {
      senderId: senderA,
      emailId: 'sender-a-email-2',
      minSendIntervalMs: minDelayMs,
      maxEmailsPerHour: 10,
      now: now + 100,
    });
    expect(resA2.status).toBe('rate_limited');

    // Sender B attempts a send at the exact same time (now + 100): MUST NOT be throttled!
    const resB = await reserveRateLimitSlot(redisClient, {
      senderId: senderB,
      emailId: 'sender-b-email-1',
      minSendIntervalMs: minDelayMs,
      maxEmailsPerHour: 10,
      now: now + 100,
    });

    expect(resB.status).toBe('allowed');
  });
});
