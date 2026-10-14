import { Client } from '@elastic/elasticsearch';
import { query } from '@reachinbox/db';

export const ELASTICSEARCH_INDEX = process.env.ELASTICSEARCH_INDEX || 'reachinbox_emails';

let esClientInstance: Client | null = null;

export function getElasticsearchClient(): Client {
  if (!esClientInstance) {
    const node =
      process.env.ELASTICSEARCH_URL ||
      process.env.ELASTICSEARCH_NODE ||
      'http://localhost:9200';

    esClientInstance = new Client({
      node,
      auth:
        process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD
          ? {
              username: process.env.ELASTICSEARCH_USERNAME,
              password: process.env.ELASTICSEARCH_PASSWORD,
            }
          : undefined,
      maxRetries: 3,
      requestTimeout: 5000,
    });
  }
  return esClientInstance;
}

export interface IndexedEmail {
  id: string;
  user_id: string;
  sender_id: string;
  sender_email?: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at?: string | null;
  created_at: string;
  updated_at?: string;
  preview_url?: string | null;
  last_error?: string | null;
}

export interface EmailSearchParams {
  query?: string;
  status?: string;
  sender_id?: string;
  page?: number;
  limit?: number;
}

export interface SearchResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Initializes and ensures the versioned Elasticsearch index and mapping schema exist.
 */
export async function ensureElasticsearchIndex(): Promise<void> {
  const client = getElasticsearchClient();
  try {
    const exists = await client.indices.exists({ index: ELASTICSEARCH_INDEX });
    if (!exists) {
      await client.indices.create({
        index: ELASTICSEARCH_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            user_id: { type: 'keyword' },
            sender_id: { type: 'keyword' },
            sender_email: { type: 'keyword' },
            recipient_email: {
              type: 'text',
              fields: { keyword: { type: 'keyword', ignore_above: 256 } },
            },
            subject: {
              type: 'text',
              analyzer: 'standard',
              fields: { keyword: { type: 'keyword', ignore_above: 512 } },
            },
            body: {
              type: 'text',
              analyzer: 'standard',
            },
            status: { type: 'keyword' },
            scheduled_at: { type: 'date' },
            sent_at: { type: 'date' },
            created_at: { type: 'date' },
            updated_at: { type: 'date' },
            preview_url: { type: 'keyword', index: false },
            last_error: { type: 'text' },
          },
        },
      });
      console.log(`[Elasticsearch] Index '${ELASTICSEARCH_INDEX}' created successfully.`);
    }
  } catch (err) {
    console.error(`[Elasticsearch] Failed to ensure index '${ELASTICSEARCH_INDEX}':`, err);
  }
}

/**
 * Indexes a single email document into Elasticsearch.
 * If Elasticsearch is unavailable, safely writes to the transactional scheduling_outbox for durable recovery.
 */
export async function indexEmailDoc(email: IndexedEmail): Promise<void> {
  const client = getElasticsearchClient();
  try {
    await client.index({
      index: ELASTICSEARCH_INDEX,
      id: email.id,
      document: email,
      refresh: process.env.NODE_ENV === 'test' ? 'wait_for' : false,
    });
  } catch (err) {
    console.warn(`[Elasticsearch] Direct index failed for email ${email.id}. Persisting to outbox:`, (err as Error).message);
    try {
      await query(
        `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload)
         VALUES ($1, $2, $3)`,
        ['elasticsearch_index', email.id, JSON.stringify(email)],
      );
    } catch (outboxErr) {
      console.error('[Elasticsearch] Failed to write outbox record:', outboxErr);
    }
  }
}

/**
 * Bulk indexes multiple emails into Elasticsearch.
 */
export async function bulkIndexEmails(emails: IndexedEmail[]): Promise<void> {
  if (emails.length === 0) return;
  const client = getElasticsearchClient();

  try {
    const operations = emails.flatMap((doc) => [
      { index: { _index: ELASTICSEARCH_INDEX, _id: doc.id } },
      doc,
    ]);

    const res = await client.bulk({
      operations,
      refresh: process.env.NODE_ENV === 'test' ? 'wait_for' : false,
    });

    if (res.errors) {
      console.warn('[Elasticsearch] Some documents failed during bulk index');
    }
  } catch (err) {
    console.warn('[Elasticsearch] Bulk indexing failed, persisting to outbox:', (err as Error).message);
    for (const email of emails) {
      await query(
        `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload)
         VALUES ($1, $2, $3)`,
        ['elasticsearch_index', email.id, JSON.stringify(email)],
      ).catch(() => null);
    }
  }
}

/**
 * Updates status and completion fields in Elasticsearch document.
 */
export async function updateEmailStatusDoc(
  emailId: string,
  update: {
    status: string;
    sent_at?: string | null;
    preview_url?: string | null;
    last_error?: string | null;
  },
): Promise<void> {
  const client = getElasticsearchClient();
  try {
    await client.update({
      index: ELASTICSEARCH_INDEX,
      id: emailId,
      doc: {
        ...update,
        updated_at: new Date().toISOString(),
      },
      refresh: process.env.NODE_ENV === 'test' ? 'wait_for' : false,
    });
  } catch {
    // If update fails (e.g. document not yet indexed or cluster offline), record outbox update
    await query(
      `INSERT INTO scheduling_outbox (event_type, aggregate_id, payload)
       VALUES ($1, $2, $3)`,
      ['elasticsearch_update', emailId, JSON.stringify(update)],
    ).catch(() => null);
  }
}

/**
 * Performs strict user-scoped full-text search against Elasticsearch.
 * Guarantees cross-tenant isolation by enforcing { term: { user_id: userId } } filter on every search.
 */
export async function searchEmails(
  userId: string,
  params: EmailSearchParams,
): Promise<SearchResult<IndexedEmail>> {
  const client = getElasticsearchClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const from = (page - 1) * limit;

  // Strict tenant isolation filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: any[] = [{ term: { user_id: userId } }];

  if (params.status && params.status.trim()) {
    filters.push({ term: { status: params.status.trim() } });
  }

  if (params.sender_id && params.sender_id.trim()) {
    filters.push({ term: { sender_id: params.sender_id.trim() } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryClause: any = { match_all: {} };

  if (params.query && params.query.trim()) {
    queryClause = {
      multi_match: {
        query: params.query.trim(),
        fields: ['subject^3', 'body', 'recipient_email^2'],
        fuzziness: 'AUTO',
      },
    };
  }

  try {
    const response = await client.search<IndexedEmail>({
      index: ELASTICSEARCH_INDEX,
      from,
      size: limit,
      query: {
        bool: {
          must: [queryClause],
          filter: filters,
        },
      },
      sort: [{ scheduled_at: { order: 'desc' } }],
    });

    const hits = response.hits.hits;
    const totalHits =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value || 0;

    const data: IndexedEmail[] = hits.map((hit) => hit._source as IndexedEmail);

    return {
      data,
      pagination: {
        page,
        limit,
        total: totalHits,
        totalPages: Math.ceil(totalHits / limit) || 1,
      },
    };
  } catch (err) {
    console.error('[Elasticsearch] Search query failed, falling back to PostgreSQL:', (err as Error).message);
    // Graceful fallback to PostgreSQL search if Elasticsearch is temporarily offline
    return searchPostgresFallback(userId, params, page, limit);
  }
}

/**
 * Fallback search query executed against PostgreSQL if Elasticsearch is unavailable.
 */
async function searchPostgresFallback(
  userId: string,
  params: EmailSearchParams,
  page: number,
  limit: number,
): Promise<SearchResult<IndexedEmail>> {
  const conditions: string[] = ['e.user_id = $1'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [userId];
  let valIdx = 2;

  if (params.status) {
    conditions.push(`e.status = $${valIdx++}`);
    values.push(params.status);
  }

  if (params.sender_id) {
    conditions.push(`e.sender_id = $${valIdx++}`);
    values.push(params.sender_id);
  }

  if (params.query && params.query.trim()) {
    conditions.push(`(e.subject ILIKE $${valIdx} OR e.body ILIKE $${valIdx} OR e.recipient_email ILIKE $${valIdx})`);
    values.push(`%${params.query.trim()}%`);
    valIdx++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM emails e WHERE ${whereClause}`,
    values,
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const dataRes = await query<IndexedEmail>(
    `SELECT e.id, e.user_id, e.sender_id, e.recipient_email, e.subject, e.body, e.status,
            e.scheduled_at, e.sent_at, e.preview_url, e.created_at, e.updated_at
     FROM emails e
     WHERE ${whereClause}
     ORDER BY e.scheduled_at DESC
     LIMIT $${valIdx++} OFFSET $${valIdx++}`,
    [...values, limit, offset],
  );

  return {
    data: dataRes.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Reconciles pending outbox events targeting Elasticsearch.
 */
export async function reconcileElasticsearchOutbox(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  const pending = await query<{ id: string; event_type: string; payload: unknown }>(
    `SELECT id, event_type, payload
     FROM scheduling_outbox
     WHERE event_type IN ('elasticsearch_index', 'elasticsearch_update') AND processed_at IS NULL
     ORDER BY created_at ASC
     LIMIT 50`,
  );

  const client = getElasticsearchClient();

  for (const row of pending.rows) {
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (row.event_type === 'elasticsearch_index') {
        await client.index({
          index: ELASTICSEARCH_INDEX,
          id: payload.id,
          document: payload,
        });
      } else if (row.event_type === 'elasticsearch_update') {
        await client.update({
          index: ELASTICSEARCH_INDEX,
          id: payload.id,
          doc: payload,
        });
      }

      await query(
        `UPDATE scheduling_outbox SET processed_at = NOW() WHERE id = $1`,
        [row.id],
      );
      processed++;
    } catch (err) {
      failed++;
      await query(
        `UPDATE scheduling_outbox
         SET attempt_count = attempt_count + 1, last_error = $2
         WHERE id = $1`,
        [row.id, (err as Error).message],
      );
    }
  }

  return { processed, failed };
}
