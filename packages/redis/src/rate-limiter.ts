import type { RedisClient } from './index.js';

/**
 * Result of an atomic rate limit reservation attempt.
 */
export type RateLimitReservationResult =
  | {
      status: 'allowed';
      currentCount: number;
      maxQuota: number;
      reservedAt: number;
      windowKey: string;
    }
  | {
      status: 'quota_exhausted';
      currentCount: number;
      maxQuota: number;
      nextEligibleTime: number;
      delayMs: number;
      windowKey: string;
    }
  | {
      status: 'rate_limited';
      currentCount: number;
      maxQuota: number;
      nextEligibleTime: number;
      delayMs: number;
      waitMs: number;
      windowKey: string;
    };

/**
 * Computes the UTC hourly window key formatted as YYYYMMDDHH (e.g. "2026101409")
 */
export function getUtcWindowKey(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}`;
}

/**
 * Computes the epoch millisecond timestamp corresponding to the start of the next UTC hour.
 */
export function getNextUtcHourTimestamp(date: Date = new Date()): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours() + 1,
    0,
    0,
    0,
  );
}

/**
 * Atomic Lua script enforcing both:
 * 1. Per-sender hourly quota (RATE-04, RATE-05, RATE-06)
 * 2. Per-sender minimum inter-send interval spacing (RATE-02, RATE-03)
 *
 * KEYS[1]: reachinbox:quota:{senderId}:{windowKey} (Set of emailIds that reserved quota in this window)
 * KEYS[2]: reachinbox:sender:{senderId}:last_send_time (String timestamp of last reserved send)
 * KEYS[3]: reachinbox:quota:{senderId}:{windowKey}:defer_counter (String counter for ordering deferred jobs)
 *
 * ARGV[1]: emailId (string)
 * ARGV[2]: now (current epoch ms)
 * ARGV[3]: maxEmailsPerHour (number)
 * ARGV[4]: minSendIntervalMs (number)
 * ARGV[5]: nextHourTimestamp (epoch ms)
 * ARGV[6]: quotaTtlSeconds (number)
 */
export const ATOMIC_RATE_LIMIT_SCRIPT = `
local quotaKey = KEYS[1]
local lastSendKey = KEYS[2]
local deferCounterKey = KEYS[3]

local emailId = ARGV[1]
local now = tonumber(ARGV[2])
local maxQuota = tonumber(ARGV[3])
local minInterval = tonumber(ARGV[4])
local nextHour = tonumber(ARGV[5])
local quotaTtl = tonumber(ARGV[6])

-- 1. Check Hourly Quota
local isMember = redis.call('SISMEMBER', quotaKey, emailId)
local currentQuotaCount = redis.call('SCARD', quotaKey)

-- If email has not already reserved a slot and quota is exhausted
if isMember == 0 and currentQuotaCount >= maxQuota then
    local deferIndex = redis.call('INCR', deferCounterKey)
    redis.call('EXPIRE', deferCounterKey, quotaTtl)
    local deferTimestamp = nextHour + ((deferIndex - 1) * minInterval)
    return { 'QUOTA_EXHAUSTED', tostring(currentQuotaCount), tostring(maxQuota), tostring(deferTimestamp) }
end

-- 2. Check Sender Minimum Inter-Send Interval
local lastSendTime = redis.call('GET', lastSendKey)
if lastSendTime then
    local lastSendNum = tonumber(lastSendTime)
    local elapsed = now - lastSendNum
    if elapsed < minInterval then
        local waitMs = minInterval - elapsed
        local eligibleTime = lastSendNum + minInterval
        return { 'RATE_LIMITED', tostring(currentQuotaCount), tostring(maxQuota), tostring(eligibleTime), tostring(waitMs) }
    end
end

-- 3. Both constraints satisfied: Reserve quota and record send slot atomically
if isMember == 0 then
    redis.call('SADD', quotaKey, emailId)
    redis.call('EXPIRE', quotaKey, quotaTtl)
    currentQuotaCount = currentQuotaCount + 1
end

-- Update last send time with safe TTL (at least 2x interval, min 60s)
local lastSendTtl = math.max(60, math.ceil((minInterval * 2) / 1000))
redis.call('SET', lastSendKey, tostring(now), 'EX', lastSendTtl)

return { 'ALLOWED', tostring(currentQuotaCount), tostring(maxQuota), tostring(now) }
`;

/**
 * Atomic Lua script to refund hourly quota for an email if established that send was not accepted (RATE-12).
 * Ambiguous crashes are never refunded.
 */
export const ATOMIC_QUOTA_REFUND_SCRIPT = `
local quotaKey = KEYS[1]
local emailId = ARGV[1]

local removed = redis.call('SREM', quotaKey, emailId)
local currentCount = redis.call('SCARD', quotaKey)
return { tostring(removed), tostring(currentCount) }
`;

export interface ReserveRateLimitParams {
  senderId: string;
  emailId: string;
  minSendIntervalMs: number;
  maxEmailsPerHour: number;
  now?: number;
}

/**
 * Atomically checks and reserves a send slot for a sender, enforcing both
 * hourly quota and minimum inter-send interval (RATE-02, RATE-03, RATE-04, RATE-05, RATE-06).
 */
export async function reserveRateLimitSlot(
  client: RedisClient,
  params: ReserveRateLimitParams,
): Promise<RateLimitReservationResult> {
  const now = params.now ?? Date.now();
  const nowDate = new Date(now);
  const windowKey = getUtcWindowKey(nowDate);
  const nextHourTimestamp = getNextUtcHourTimestamp(nowDate);
  const quotaTtlSeconds = 7200; // 2 hours retention for auto-cleanup

  const quotaKey = `reachinbox:quota:${params.senderId}:${windowKey}`;
  const lastSendKey = `reachinbox:sender:${params.senderId}:last_send_time`;
  const deferCounterKey = `reachinbox:quota:${params.senderId}:${windowKey}:defer_counter`;

  const result = (await client.eval(
    ATOMIC_RATE_LIMIT_SCRIPT,
    3,
    quotaKey,
    lastSendKey,
    deferCounterKey,
    params.emailId,
    String(now),
    String(params.maxEmailsPerHour),
    String(params.minSendIntervalMs),
    String(nextHourTimestamp),
    String(quotaTtlSeconds),
  )) as string[];

  const outcome = result[0];
  const currentCount = parseInt(result[1], 10);
  const maxQuota = parseInt(result[2], 10);

  if (outcome === 'QUOTA_EXHAUSTED') {
    const nextEligibleTime = parseInt(result[3], 10);
    const delayMs = Math.max(0, nextEligibleTime - now);
    return {
      status: 'quota_exhausted',
      currentCount,
      maxQuota,
      nextEligibleTime,
      delayMs,
      windowKey,
    };
  }

  if (outcome === 'RATE_LIMITED') {
    const nextEligibleTime = parseInt(result[3], 10);
    const waitMs = parseInt(result[4], 10);
    const delayMs = Math.max(0, nextEligibleTime - now);
    return {
      status: 'rate_limited',
      currentCount,
      maxQuota,
      nextEligibleTime,
      delayMs,
      waitMs,
      windowKey,
    };
  }

  const reservedAt = parseInt(result[3], 10);
  return {
    status: 'allowed',
    currentCount,
    maxQuota,
    reservedAt,
    windowKey,
  };
}

/**
 * Atomically refunds a sender's quota reservation if send was not accepted (RATE-12).
 * Only call when non-acceptance is definitively established.
 */
export async function refundRateLimitQuota(
  client: RedisClient,
  params: { senderId: string; emailId: string; windowKey?: string },
): Promise<{ refunded: boolean; currentCount: number }> {
  const windowKey = params.windowKey ?? getUtcWindowKey();
  const quotaKey = `reachinbox:quota:${params.senderId}:${windowKey}`;

  const result = (await client.eval(
    ATOMIC_QUOTA_REFUND_SCRIPT,
    1,
    quotaKey,
    params.emailId,
  )) as string[];

  return {
    refunded: result[0] === '1',
    currentCount: parseInt(result[1], 10),
  };
}

/**
 * Inspects current quota and send state for a sender (useful for testing and monitoring).
 */
export async function getSenderRateLimitState(
  client: RedisClient,
  params: { senderId: string; windowKey?: string },
): Promise<{ quotaCount: number; lastSendTime: number | null }> {
  const windowKey = params.windowKey ?? getUtcWindowKey();
  const quotaKey = `reachinbox:quota:${params.senderId}:${windowKey}`;
  const lastSendKey = `reachinbox:sender:${params.senderId}:last_send_time`;

  const [count, lastSend] = await Promise.all([
    client.scard(quotaKey),
    client.get(lastSendKey),
  ]);

  return {
    quotaCount: count,
    lastSendTime: lastSend ? parseInt(lastSend, 10) : null,
  };
}

/**
 * Resets all rate-limit keys for a sender (intended for test environments).
 */
export async function resetSenderRateLimits(
  client: RedisClient,
  senderId: string,
  windowKey?: string,
): Promise<void> {
  const window = windowKey ?? getUtcWindowKey();
  const quotaKey = `reachinbox:quota:${senderId}:${window}`;
  const lastSendKey = `reachinbox:sender:${senderId}:last_send_time`;
  const deferCounterKey = `reachinbox:quota:${senderId}:${window}:defer_counter`;

  await client.del(quotaKey, lastSendKey, deferCounterKey);
}
