import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  getRedisClient,
  closeRedis,
  reserveRateLimitSlot,
  refundRateLimitQuota,
  resetSenderRateLimits,
  getUtcWindowKey,
  getNextUtcHourTimestamp,
} from '@reachinbox/redis';

describe('Distributed Rate Limiting: Hourly Quota Reservations (RATE-04, RATE-05, RATE-12)', () => {
  const testSenderId = crypto.randomUUID();
  let redisClient: ReturnType<typeof getRedisClient>;

  beforeAll(async () => {
    redisClient = getRedisClient();
    await resetSenderRateLimits(redisClient, testSenderId);
  });

  afterAll(async () => {
    await resetSenderRateLimits(redisClient, testSenderId);
    await closeRedis();
  });

  it('atomically enforces hourly quota cap and prevents exceeding limit (RATE-04, RATE-05)', async () => {
    const hourlyLimit = 5;
    const now = Date.now();
    const windowKey = getUtcWindowKey(new Date(now));

    // Attempt to schedule 5 emails within the same hour
    const reservations = await Promise.all(
      Array.from({ length: hourlyLimit }, (_, i) =>
        reserveRateLimitSlot(redisClient, {
          senderId: testSenderId,
          emailId: `email-slot-${i}`,
          minSendIntervalMs: 0, // Focus purely on quota
          maxEmailsPerHour: hourlyLimit,
          now,
        }),
      ),
    );

    // All 5 emails must be granted quota
    for (const res of reservations) {
      expect(res.status).toBe('allowed');
      if (res.status === 'allowed') {
        expect(res.maxQuota).toBe(hourlyLimit);
        expect(res.windowKey).toBe(windowKey);
      }
    }

    // The 6th email must be rejected with QUOTA_EXHAUSTED
    const sixthAttempt = await reserveRateLimitSlot(redisClient, {
      senderId: testSenderId,
      emailId: 'email-slot-6-overflow',
      minSendIntervalMs: 0,
      maxEmailsPerHour: hourlyLimit,
      now,
    });

    expect(sixthAttempt.status).toBe('quota_exhausted');
    if (sixthAttempt.status === 'quota_exhausted') {
      expect(sixthAttempt.currentCount).toBe(hourlyLimit);
      expect(sixthAttempt.maxQuota).toBe(hourlyLimit);
      expect(sixthAttempt.nextEligibleTime).toBeGreaterThan(now);
      expect(sixthAttempt.nextEligibleTime).toBe(getNextUtcHourTimestamp(new Date(now)));
    }
  });

  it('guarantees idempotency on retries: reprocessing same emailId does not consume extra quota', async () => {
    const senderId = crypto.randomUUID();
    const hourlyLimit = 3;
    const now = Date.now();
    const emailId = 'email-retry-idempotent';

    // First reservation
    const firstRes = await reserveRateLimitSlot(redisClient, {
      senderId,
      emailId,
      minSendIntervalMs: 0,
      maxEmailsPerHour: hourlyLimit,
      now,
    });
    expect(firstRes.status).toBe('allowed');
    expect(firstRes.currentCount).toBe(1);

    // Immediate retry with the exact same emailId (simulating worker crash / retry)
    const retryRes = await reserveRateLimitSlot(redisClient, {
      senderId,
      emailId,
      minSendIntervalMs: 0,
      maxEmailsPerHour: hourlyLimit,
      now: now + 50,
    });

    expect(retryRes.status).toBe('allowed');
    expect(retryRes.currentCount).toBe(1); // Still 1, NOT 2!
  });

  it('enforces multi-worker concurrency safety: parallel reservation attempts never exceed cap (RATE-05)', async () => {
    const concurrentSender = crypto.randomUUID();
    const hourlyCap = 10;
    const workerCount = 30; // 30 concurrent workers competing for 10 quota slots
    const now = Date.now();

    const results = await Promise.all(
      Array.from({ length: workerCount }, (_, i) =>
        reserveRateLimitSlot(redisClient, {
          senderId: concurrentSender,
          emailId: `concurrent-worker-email-${i}`,
          minSendIntervalMs: 0,
          maxEmailsPerHour: hourlyCap,
          now,
        }),
      ),
    );

    const allowed = results.filter((r) => r.status === 'allowed');
    const exhausted = results.filter((r) => r.status === 'quota_exhausted');

    expect(allowed.length).toBe(hourlyCap);
    expect(exhausted.length).toBe(workerCount - hourlyCap);
  });

  it('safely refunds quota on definitive pre-acceptance failures, but preserves quota on ambiguous outcomes (RATE-12)', async () => {
    const senderId = crypto.randomUUID();
    const hourlyLimit = 1;
    const now = Date.now();
    const emailId = 'email-refund-test';

    // 1. Reserve single available slot
    const res = await reserveRateLimitSlot(redisClient, {
      senderId,
      emailId,
      minSendIntervalMs: 0,
      maxEmailsPerHour: hourlyLimit,
      now,
    });
    expect(res.status).toBe('allowed');

    // 2. Second email is blocked
    const blockedRes = await reserveRateLimitSlot(redisClient, {
      senderId,
      emailId: 'email-blocked-2',
      minSendIntervalMs: 0,
      maxEmailsPerHour: hourlyLimit,
      now,
    });
    expect(blockedRes.status).toBe('quota_exhausted');

    // 3. Email 1 encounters definitive pre-acceptance failure (e.g. SMTP rejected, not accepted)
    // Refund is permitted:
    const refundResult = await refundRateLimitQuota(redisClient, {
      senderId,
      emailId,
    });
    expect(refundResult.refunded).toBe(true);
    expect(refundResult.currentCount).toBe(0);

    // 4. Slot is now available again for a subsequent email
    const retryAfterRefund = await reserveRateLimitSlot(redisClient, {
      senderId,
      emailId: 'email-blocked-2',
      minSendIntervalMs: 0,
      maxEmailsPerHour: hourlyLimit,
      now,
    });
    expect(retryAfterRefund.status).toBe('allowed');
  });
});
