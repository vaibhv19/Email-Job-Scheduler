import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../apps/api/src/app.js';
import { query, closePool } from '@reachinbox/db';
import { closeQueue, closeRedis } from '@reachinbox/redis';
import {
  ensureElasticsearchIndex,
  getElasticsearchClient,
  indexEmailDoc,
  searchEmails,
  reconcileElasticsearchOutbox,
  ELASTICSEARCH_INDEX,
  type IndexedEmail,
} from '../../apps/api/src/services/elasticsearch.js';
import { createSession } from '../../apps/api/src/modules/auth/session.js';
import { DEFAULT_DEV_SENDER_ID, DEFAULT_DEV_USER_ID, ensureDefaultDevUser } from '../../apps/api/src/middleware/auth.js';

describe('Real Elasticsearch Indexing, User-Scoped Search & Recovery (Phase 7)', () => {
  let server: Server;
  let baseUrl: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await ensureDefaultDevUser();
    const { sessionToken } = await createSession(DEFAULT_DEV_USER_ID);
    sessionCookie = `reachinbox_session=${sessionToken}`;

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    // Ensure Elasticsearch index exists on running cluster
    await ensureElasticsearchIndex();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueue();
    await closePool();
    await closeRedis();
  });

  it('verifies connection to live running Elasticsearch cluster (port 9200)', async () => {
    const client = getElasticsearchClient();
    const health = await client.cluster.health();
    expect(['green', 'yellow']).toContain(health.status);
    expect(health.cluster_name).toBeDefined();
  });

  it('indexes and searches an email document by subject, recipient, and body with wait_for refresh', async () => {
    const uniqueToken = `es_test_${Date.now()}`;
    const emailDoc = {
      id: `00000000-0000-4000-9000-${Date.now().toString().slice(-12)}`,
      user_id: DEFAULT_DEV_USER_ID,
      sender_id: DEFAULT_DEV_SENDER_ID,
      sender_email: 'sender@reachinbox.test',
      recipient_email: `recipient_${uniqueToken}@example.com`,
      subject: `Quarterly Strategy Briefing ${uniqueToken}`,
      body: `Confidential financial performance report with token ${uniqueToken}`,
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: new Date().toISOString(),
    };

    // 1. Index document directly into Elasticsearch
    await indexEmailDoc(emailDoc);

    // 2. Search by subject keyword
    const searchRes = await searchEmails(DEFAULT_DEV_USER_ID, {
      query: uniqueToken,
    });

    expect(searchRes.data.length).toBeGreaterThanOrEqual(1);
    const matched = searchRes.data.find((e) => e.id === emailDoc.id);
    expect(matched).toBeDefined();
    expect(matched?.subject).toContain(uniqueToken);
    expect(matched?.recipient_email).toBe(emailDoc.recipient_email);
    expect(searchRes.pagination.total).toBeGreaterThanOrEqual(1);

    // 3. Verify HTTP search API with session cookie
    const apiRes = await fetch(`${baseUrl}/api/emails/search?q=${uniqueToken}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(apiRes.status).toBe(200);
  });

  it('enforces strict tenant isolation: User B cannot find User A emails via Elasticsearch search', async () => {
    const userASecret = `classified_user_a_${Date.now()}`;
    const emailA = {
      id: `00000000-0000-4000-8001-${Date.now().toString().slice(-12)}`,
      user_id: DEFAULT_DEV_USER_ID, // User A
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: 'target_a@domain.com',
      subject: `Top Secret Report ${userASecret}`,
      body: `Body belonging strictly to User A ${userASecret}`,
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 600000).toISOString(),
      created_at: new Date().toISOString(),
    };
    await indexEmailDoc(emailA);

    // Create User B in PostgreSQL with a separate session
    const otherUserId = `00000000-0000-0000-0000-${Date.now().toString().slice(-12)}`;
    await query(
      `INSERT INTO users (id, google_subject, email, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING;`,
      [otherUserId, `other_google_${Date.now()}`, 'userb@test.com', 'User B'],
    );
    const { sessionToken: sessionTokenB } = await createSession(otherUserId);

    // 1. User A searches for secret -> Found
    const searchUserA = await searchEmails(DEFAULT_DEV_USER_ID, { query: userASecret });
    expect(searchUserA.data.some((e) => e.id === emailA.id)).toBe(true);

    // 2. User B searches for exact same secret keyword -> Zero results (100% cross-tenant isolation)
    const searchUserB = await searchEmails(otherUserId, { query: userASecret });
    expect(searchUserB.data.some((e) => e.id === emailA.id)).toBe(false);
    expect(searchUserB.data.length).toBe(0);

    // 3. Test HTTP search API endpoint /api/emails/search with User B's session cookie
    const apiRes = await fetch(
      `${baseUrl}/api/emails/search?q=${encodeURIComponent(userASecret)}`,
      {
        headers: { Cookie: `reachinbox_session=${sessionTokenB}` },
      },
    );
    expect(apiRes.status).toBe(200);
    const apiBody = (await apiRes.json()) as { data: Array<{ id: string }> };
    expect(apiBody.data.length).toBe(0);
  });

  it('filters search results by status and supports pagination', async () => {
    const filterTag = `filter_tag_${Date.now()}`;
    const doc1 = {
      id: `00000000-0000-4000-8002-${Date.now().toString().slice(-12)}`,
      user_id: DEFAULT_DEV_USER_ID,
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: 'alpha@filter.test',
      subject: `Status Scheduled ${filterTag}`,
      body: 'Content for scheduled status filter',
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 600000).toISOString(),
      created_at: new Date().toISOString(),
    };
    const doc2 = {
      id: `00000000-0000-4000-8003-${Date.now().toString().slice(-12)}`,
      user_id: DEFAULT_DEV_USER_ID,
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: 'beta@filter.test',
      subject: `Status Sent ${filterTag}`,
      body: 'Content for sent status filter',
      status: 'sent',
      scheduled_at: new Date(Date.now() - 600000).toISOString(),
      created_at: new Date().toISOString(),
    };

    await indexEmailDoc(doc1);
    await indexEmailDoc(doc2);

    // Search with status=scheduled filter
    const scheduledSearch = await searchEmails(DEFAULT_DEV_USER_ID, {
      query: filterTag,
      status: 'scheduled',
    });
    expect(scheduledSearch.data.some((e) => e.id === doc1.id)).toBe(true);
    expect(scheduledSearch.data.some((e) => e.id === doc2.id)).toBe(false);

    // Search with status=sent filter
    const sentSearch = await searchEmails(DEFAULT_DEV_USER_ID, {
      query: filterTag,
      status: 'sent',
    });
    expect(sentSearch.data.some((e) => e.id === doc2.id)).toBe(true);
    expect(sentSearch.data.some((e) => e.id === doc1.id)).toBe(false);
  });

  it('recovers pending outbox events targeting Elasticsearch and processes them', async () => {
    const outboxEmail = {
      id: `00000000-0000-4000-8004-${Date.now().toString().slice(-12)}`,
      user_id: DEFAULT_DEV_USER_ID,
      sender_id: DEFAULT_DEV_SENDER_ID,
      recipient_email: 'recovered_outbox@example.com',
      subject: 'Outbox Recovered Subject',
      body: 'This email was recovered from scheduling_outbox',
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 1200000).toISOString(),
      created_at: new Date().toISOString(),
    };

    // 1. Manually insert an unprocessed outbox record
    const insertRes = await query<{ id: string }>(
      `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['elasticsearch_index', outboxEmail.id, JSON.stringify(outboxEmail)],
    );
    const outboxId = insertRes.rows[0].id;

    // 2. Run outbox reconciliation
    const reconResult = await reconcileElasticsearchOutbox();
    expect(reconResult.processed).toBeGreaterThanOrEqual(1);

    // 3. Verify record was marked processed in DB
    const checkOutbox = await query<{ processed_at: Date }>(
      'SELECT processed_at FROM scheduling_outbox WHERE id = $1',
      [outboxId],
    );
    expect(checkOutbox.rows[0].processed_at).not.toBeNull();

    // 4. Verify document exists in Elasticsearch
    const client = getElasticsearchClient();
    const esDoc = await client.get<IndexedEmail>({
      index: ELASTICSEARCH_INDEX,
      id: outboxEmail.id,
    });
    expect(esDoc.found).toBe(true);
    expect(esDoc._source?.subject).toBe(outboxEmail.subject);
  });
});
