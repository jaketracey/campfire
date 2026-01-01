/**
 * Database module entry point
 * Exports connection pool, utilities, and types
 */

export { db, sql, createPool, closePool, type DatabaseConfig } from './pool.js';
export { migrate, getMigrationStatus } from './migrate.js';
export * from './types.js';
