import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Attempt to load .env from workspace root if DATABASE_URL is not yet set
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const { Pool } = pg;

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max?: number;
}

export function resolveDatabaseConfig(): DatabaseConfig {
  // Canonical precedence: DATABASE_URL takes priority
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: process.env.DB_MAX_CONNECTIONS ? parseInt(process.env.DB_MAX_CONNECTIONS, 10) : 20,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5433,
    database: process.env.DB_NAME || 'email_scheduler',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: process.env.DB_MAX_CONNECTIONS ? parseInt(process.env.DB_MAX_CONNECTIONS, 10) : 20,
  };
}

let globalPool: pg.Pool | null = null;

export function getPool(configOverride?: DatabaseConfig): pg.Pool {
  if (configOverride) {
    return new Pool(configOverride);
  }

  if (!globalPool) {
    const config = resolveDatabaseConfig();
    globalPool = new Pool(config);

    globalPool.on('error', (err) => {
      console.error('Unexpected idle client error in PostgreSQL pool', err);
    });
  }

  return globalPool;
}

export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check probe: returns true if database responds to SELECT 1
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const pool = getPool();
    const res = await pool.query('SELECT 1 AS healthy');
    return res.rows.length > 0 && res.rows[0].healthy === 1;
  } catch {
    return false;
  }
}

/**
 * Validates that destructive test operations (such as resets or truncations)
 * only execute against an authorized test database target.
 */
export async function verifyDatabaseTarget(expectedTarget: 'test' | 'development'): Promise<{
  safe: boolean;
  database: string;
  host: string;
}> {
  const pool = getPool();
  const res = await pool.query<{ current_database: string; inet_server_addr: string }>(
    'SELECT current_database(), inet_server_addr()::text',
  );
  const dbName = res.rows[0]?.current_database || '';
  const host = res.rows[0]?.inet_server_addr || 'localhost';

  if (expectedTarget === 'test') {
    const isTest = dbName.toLowerCase().includes('test');
    return { safe: isTest, database: dbName, host };
  }

  return { safe: true, database: dbName, host };
}
