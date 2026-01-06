/**
 * PostgreSQL Connection Pool
 * Uses postgres.js for high-performance connection pooling
 */

import postgres from 'postgres';
import { env } from '../env.js';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean | 'require' | 'prefer';
  max?: number;
  idle_timeout?: number;
  connect_timeout?: number;
  max_lifetime?: number;
}

function getConfig(): DatabaseConfig {
  const config: DatabaseConfig = {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    ssl: env.DATABASE_SSL ? 'require' : false,
    max: env.DATABASE_POOL_MAX,
    idle_timeout: env.DATABASE_IDLE_TIMEOUT,
    connect_timeout: env.DATABASE_CONNECT_TIMEOUT,
    max_lifetime: env.DATABASE_MAX_LIFETIME,
  };

  return config;
}

let _sql: postgres.Sql | null = null;

export function createPool(config?: DatabaseConfig): postgres.Sql {
  const cfg = config ?? getConfig();

  const sql = postgres({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    username: cfg.username,
    password: cfg.password,
    ssl: cfg.ssl ?? false,
    max: cfg.max ?? 20,
    idle_timeout: cfg.idle_timeout ?? 20,
    connect_timeout: cfg.connect_timeout ?? 10,
    max_lifetime: cfg.max_lifetime ?? 3600,

    // Transform column names from snake_case to snake_case (keep as-is)
    transform: {
      undefined: null,
    },

    // Connection lifecycle hooks
    onnotice: (notice) => {
      if (env.NODE_ENV !== 'production') {
        console.log('[DB Notice]', notice.message);
      }
    },

    // Debug mode for development
    ...(env.DATABASE_DEBUG && {
      debug: (connection: number, query: string, params: unknown[]) => {
        console.log('[DB Query]', query);
        if (params.length > 0) {
          console.log('[DB Params]', params);
        }
      },
    }),
  });

  _sql = sql;
  return sql;
}

export function sql(): postgres.Sql {
  if (!_sql) {
    _sql = createPool();
  }
  return _sql;
}

export const db = {
  get sql() {
    return sql();
  },

  query: sql,

  async transaction<T>(
    fn: (sql: postgres.TransactionSql) => Promise<T>
  ): Promise<T> {
    return sql().begin(fn) as Promise<T>;
  },

  async healthCheck(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await sql()`SELECT 1`;
      return {
        ok: true,
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  async getPoolStats(): Promise<{
    total: number;
    idle: number;
    waiting: number;
  }> {
    // postgres.js doesn't expose pool stats directly
    // This is a placeholder for monitoring
    return {
      total: 0,
      idle: 0,
      waiting: 0,
    };
  },
};

export async function closePool(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('[DB] Received SIGTERM, closing pool...');
  await closePool();
});

process.on('SIGINT', async () => {
  console.log('[DB] Received SIGINT, closing pool...');
  await closePool();
});
