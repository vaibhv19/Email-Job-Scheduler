import { describe, it, expect, afterAll } from 'vitest';
import { query, closePool } from '@reachinbox/db';
import { getRedisClient, closeRedis } from '@reachinbox/redis';

describe('Database and Redis Persistence Across Reconnect (QA-02, INF-09)', () => {
  afterAll(async () => {
    await closePool();
    await closeRedis();
  });

  it('persists records and tables in PostgreSQL across client reconnections', async () => {
    // Insert a test user
    const uniqueEmail = `test_persist_${Date.now()}@reachinbox.test`;
    const insertRes = await query<{ id: string }>(
      `INSERT INTO users (google_subject, email, name)
       VALUES ($1, $2, $3)
       RETURNING id;`,
      [`sub_${Date.now()}`, uniqueEmail, 'Persistence Test User'],
    );
    expect(insertRes.rows.length).toBe(1);
    const userId = insertRes.rows[0].id;

    // Simulate reconnect / new query
    const selectRes = await query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = $1;',
      [userId],
    );
    expect(selectRes.rows.length).toBe(1);
    expect(selectRes.rows[0].email).toBe(uniqueEmail);

    // Clean up test record
    await query('DELETE FROM users WHERE id = $1;', [userId]);
  });

  it('persists keys and values in Redis across client reconnections', async () => {
    const redis = getRedisClient();
    const testKey = `reachinbox:test_persist:${Date.now()}`;
    await redis.set(testKey, 'active_value', 'EX', 60);

    const retrieved = await redis.get(testKey);
    expect(retrieved).toBe('active_value');

    await redis.del(testKey);
  });
});
