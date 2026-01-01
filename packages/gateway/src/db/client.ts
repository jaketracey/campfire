/**
 * PostgreSQL database client using postgres.js
 * Provides connection management and query execution.
 */

import postgres from 'postgres';
import { logger } from '../observability/logger.js';

/**
 * Database configuration from environment
 */
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean | 'require' | 'prefer';
  maxConnections: number;
  idleTimeout: number;
  connectionTimeout: number;
}

function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env['DATABASE_HOST'] ?? 'localhost',
    port: parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
    database: process.env['DATABASE_NAME'] ?? 'campfire',
    username: process.env['DATABASE_USER'] ?? 'campfire',
    password: process.env['DATABASE_PASSWORD'] ?? 'campfire',
    ssl: process.env['DATABASE_SSL'] === 'true' ? 'require' : false,
    maxConnections: parseInt(process.env['DATABASE_MAX_CONNECTIONS'] ?? '20', 10),
    idleTimeout: parseInt(process.env['DATABASE_IDLE_TIMEOUT'] ?? '20', 10),
    connectionTimeout: parseInt(process.env['DATABASE_CONNECTION_TIMEOUT'] ?? '30', 10),
  };
}

/**
 * Create a new database connection pool
 */
export function createDatabaseClient(config?: Partial<DatabaseConfig>) {
  const fullConfig = { ...getDatabaseConfig(), ...config };

  const sql = postgres({
    host: fullConfig.host,
    port: fullConfig.port,
    database: fullConfig.database,
    username: fullConfig.username,
    password: fullConfig.password,
    ssl: fullConfig.ssl,
    max: fullConfig.maxConnections,
    idle_timeout: fullConfig.idleTimeout,
    connect_timeout: fullConfig.connectionTimeout,
    onnotice: (notice) => {
      logger.debug({ notice: notice.message }, 'Database notice');
    },
    transform: {
      undefined: null,
    },
    types: {
      // Handle BigInt as number for compatibility
      bigint: postgres.BigInt,
    },
  });

  return sql;
}

// Default database client instance
let defaultClient: ReturnType<typeof createDatabaseClient> | null = null;

/**
 * Get the default database client
 */
export function getDatabase(): ReturnType<typeof createDatabaseClient> {
  if (!defaultClient) {
    defaultClient = createDatabaseClient();
    logger.info('Database client initialized');
  }
  return defaultClient;
}

/**
 * Close the database connection pool
 */
export async function closeDatabase(): Promise<void> {
  if (defaultClient) {
    await defaultClient.end();
    defaultClient = null;
    logger.info('Database connection pool closed');
  }
}

/**
 * Check database connectivity
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const sql = getDatabase();
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');
    return false;
  }
}

/**
 * Execute a query with transaction support
 */
export async function withTransaction<T>(
  fn: (sql: ReturnType<typeof createDatabaseClient>) => Promise<T>
): Promise<T> {
  const sql = getDatabase();
  return sql.begin(async (tx) => {
    return fn(tx as ReturnType<typeof createDatabaseClient>);
  });
}
