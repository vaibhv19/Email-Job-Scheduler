import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { query, closePool } from '@reachinbox/db';
import {
  getRedisClient,
  closeRedis,
  closeQueue,
  resetSenderRateLimits,
  reserveRateLimitSlot,
  getNextUtcHourTimestamp,
} from '@reachinbox/redis';
import { scheduleEmails } from '../../apps/api/src/services/email.js';
import { processEmailJob } from '../../apps/worker/src/processor.js';
import {
  DEFAULT_DEV_USER_ID,
  DEFAULT_DEV_SENDER_ID,
  ensureDefaultDevUser,
} from '../../apps/api/src/middleware/auth.js';
import type { Job } from 'bullmq';

describe('Distributed Rate Limiting: Deferral, Batch Ingestion & Ordering (RATE-09, RATE-10, RATE-11, RATE-13, RATE-16, RATE-17, RATE-18, RATE-20, RATE-21)', () => {
  let redisClient: ReturnType<typeof getRedisClient>;
  let quotaSenderId: string;

  beforeAll(async () => {
    await ensureDefaultDevUser();
    redisClient = getRedisClient();

    // Create a dedicated sender with low quota for deferral testing
    quotaSenderId = '00000000-0000-4000-8000-000000000005';
    await query(
      `INSERT INTO senders (id, user_id, email, display_name, smtp_config_ref, min_send_interval_ms, max_emails_per_hour)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET max_emails_per_hour = EXCLUDED.max_emails_per_hour, min_send_interval_ms = EXCLUDED.min_send_interval_ms;`,
      [
        quotaSenderId,
        DEFAULT_DEV_USER_ID,
        'quota-test@reachinbox.test',
        'Quota Test Sender',
        'ethereal_default',
        1000,
        2, // Only 2 emails per hour
      ],
    );

    await resetSenderRateLimits(redisClient, quotaSenderId);
  });

  afterAll(async () => {
    await resetSenderRateLimits(redisClient, quotaSenderId);
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('defers jobs to the next UTC hour when quota is exhausted without failing or dropping them (RATE-09, RATE-11, RATE-17, RATE-18)', async () => {
    const email1Id = crypto.randomUUID();
    const email2Id = crypto.randomUUID();
    const email3Id = crypto.randomUUID();

    // Insert 3 emails scheduled for now
    for (const id of [email1Id, email2Id, email3Id]) {
      await query(
        `INSERT INTO emails (id, user_id, sender_id, recipient_email, subject, body, scheduled_at, status, bullmq_job_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), 'scheduled', $7);`,
        [id, DEFAULT_DEV_USER_ID, quotaSenderId, `recipient-${id}@example.com`, 'Test Subject', 'Body', id],
      );
    }

    let deferredTimestamp = 0;
    const mockJob3 = {
      data: {
        emailId: email3Id,
        senderId: quotaSenderId,
        userId: DEFAULT_DEV_USER_ID,
        recipientEmail: `recipient-${email3Id}@example.com`,
        subject: 'Test Subject',
        scheduledAt: new Date().toISOString(),
      },
      token: 'test-worker-token-3',
      attemptsMade: 0,
      opts: { attempts: 3 },
      moveToDelayed: async (timestamp: number) => {
        deferredTimestamp = timestamp;
      },
    } as unknown as Job;

    // Send email 1 (uses quota slot 1/2)
    const res1 = await reserveRateLimitSlot(redisClient, {
      senderId: quotaSenderId,
      emailId: email1Id,
      minSendIntervalMs: 0,
      maxEmailsPerHour: 2,
    });
    expect(res1.status).toBe('allowed');

    // Send email 2 (uses quota slot 2/2)
    const res2 = await reserveRateLimitSlot(redisClient, {
      senderId: quotaSenderId,
      emailId: email2Id,
      minSendIntervalMs: 0,
      maxEmailsPerHour: 2,
    });
    expect(res2.status).toBe('allowed');

    // Email 3 should encounter quota exhaustion and throw DelayedError
    await expect(processEmailJob(mockJob3, 'test-worker-token-3')).rejects.toThrow();

    // Verify BullMQ job was deferred to the start of the next UTC hour (RATE-09)
    const expectedNextUtcHour = getNextUtcHourTimestamp();
    expect(deferredTimestamp).toBeGreaterThanOrEqual(expectedNextUtcHour);

    // CRITICAL: Verify database status remains 'scheduled', NOT 'failed' (RATE-11, RATE-17)
    const email3Row = await query<{ status: string; bullmq_job_id: string }>(
      'SELECT status, bullmq_job_id FROM emails WHERE id = $1',
      [email3Id],
    );
    expect(email3Row.rows[0].status).toBe('scheduled');
    expect(email3Row.rows[0].bullmq_job_id).toBe(email3Id); // Identity preserved (RATE-18)
  });

  it('preserves relative job order during deferral with deterministic offsets (RATE-10)', async () => {
    const orderSenderId = crypto.randomUUID();
    const now = Date.now();
    const hourlyLimit = 1;
    const minDelay = 2000;

    // Consume the single available slot
    await reserveRateLimitSlot(redisClient, {
      senderId: orderSenderId,
      emailId: 'initial-slot',
      minSendIntervalMs: minDelay,
      maxEmailsPerHour: hourlyLimit,
      now,
    });

    // Attempt to defer 3 consecutive emails
    const defer1 = await reserveRateLimitSlot(redisClient, {
      senderId: orderSenderId,
      emailId: 'deferred-1',
      minSendIntervalMs: minDelay,
      maxEmailsPerHour: hourlyLimit,
      now,
    });

    const defer2 = await reserveRateLimitSlot(redisClient, {
      senderId: orderSenderId,
      emailId: 'deferred-2',
      minSendIntervalMs: minDelay,
      maxEmailsPerHour: hourlyLimit,
      now,
    });

    const defer3 = await reserveRateLimitSlot(redisClient, {
      senderId: orderSenderId,
      emailId: 'deferred-3',
      minSendIntervalMs: minDelay,
      maxEmailsPerHour: hourlyLimit,
      now,
    });

    expect(defer1.status).toBe('quota_exhausted');
    expect(defer2.status).toBe('quota_exhausted');
    expect(defer3.status).toBe('quota_exhausted');

    if (
      defer1.status === 'quota_exhausted' &&
      defer2.status === 'quota_exhausted' &&
      defer3.status === 'quota_exhausted'
    ) {
      // Relative ordering must be strictly preserved: defer1 < defer2 < defer3 spaced by minDelay
      expect(defer2.nextEligibleTime - defer1.nextEligibleTime).toBe(minDelay);
      expect(defer3.nextEligibleTime - defer2.nextEligibleTime).toBe(minDelay);
    }
  });

  it('staggers batch scheduled timestamps by min_send_interval_ms (RATE-16, RATE-20, RATE-21)', async () => {
    const futureDate = new Date(Date.now() + 60000);
    const recipients = [
      'stagger_1@example.com',
      'stagger_2@example.com',
      'stagger_3@example.com',
    ];

    const result = await scheduleEmails(DEFAULT_DEV_USER_ID, {
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_emails: recipients,
      subject: 'Staggered Batch Test',
      body: 'Body',
      scheduled_at: futureDate.toISOString(),
    });

    expect(result.scheduledCount).toBe(3);
    const rows = result.data as Array<{ scheduled_at: string }>;

    const t0 = new Date(rows[0].scheduled_at).getTime();
    const t1 = new Date(rows[1].scheduled_at).getTime();
    const t2 = new Date(rows[2].scheduled_at).getTime();

    // Verify send times are >= requested start time (RATE-16, RATE-21)
    expect(t0).toBeGreaterThanOrEqual(futureDate.getTime());

    // Verify send times are spaced by sender min_send_interval_ms (RATE-16, RATE-20)
    expect(t1 - t0).toBeGreaterThanOrEqual(2000); // DEFAULT_MIN_SEND_INTERVAL_MS = 2000
    expect(t2 - t1).toBeGreaterThanOrEqual(2000);
  });

  it('efficiently schedules a batch of 1,000 recipients via chunked persistence and addBulk (RATE-13)', async () => {
    const thousandRecipients: string[] = [];
    for (let i = 0; i < 1000; i++) {
      thousandRecipients.push(`load_test_${i}@example.com`);
    }

    const scheduledTime = new Date(Date.now() + 120000);
    const startTime = Date.now();
    const batchSubject = `1000 Email Batch Test ${crypto.randomUUID()}`;

    const result = await scheduleEmails(DEFAULT_DEV_USER_ID, {
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_emails: thousandRecipients,
      subject: batchSubject,
      body: 'Load test batch body',
      scheduled_at: scheduledTime.toISOString(),
    });

    const elapsedMs = Date.now() - startTime;
    console.log(`[Load Test] 1,000 email batch scheduled in ${elapsedMs}ms.`);

    expect(result.isBulk).toBe(true);
    expect(result.scheduledCount).toBe(1000);

    // Verify all 1,000 records were persisted to PostgreSQL
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM emails WHERE subject = $1`,
      [batchSubject],
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1000);

    // Verify performance: 1,000 emails persisted within 10 seconds
    expect(elapsedMs).toBeLessThan(10000);
  });
});
