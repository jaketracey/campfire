/**
 * Migration: Create PostgreSQL Extensions
 * Created: 2026-01-01
 *
 * Enables required PostgreSQL extensions:
 * - uuid-ossp: UUID generation functions
 * - pgvector: Vector similarity search for embeddings
 * - pg_trgm: Trigram matching for text search
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // UUID generation functions
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  // Vector similarity search for memory embeddings (1536 dimensions for OpenAI ada-002)
  await sql`CREATE EXTENSION IF NOT EXISTS "vector"`;

  // Trigram matching for fuzzy text search
  await sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Note: Dropping extensions can be dangerous in production
  // Only drop if no dependent objects exist
  await sql`DROP EXTENSION IF EXISTS "pg_trgm"`;
  await sql`DROP EXTENSION IF EXISTS "vector"`;
  await sql`DROP EXTENSION IF EXISTS "uuid-ossp"`;
}
