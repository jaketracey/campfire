/**
 * Migration: Create companion_memory_documents table
 * Created: 2026-04-11
 *
 * Stores Karpathy-style LLM memory documents per companion-user pair.
 * Compiled asynchronously after every ~3 turns by Claude Haiku.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS companion_memory_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      last_compiled_at TIMESTAMPTZ,
      last_compiled_turn_id UUID,
      compilation_count INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, companion_id)
    )
  `;

  // Index for lookups by user + companion
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memory_documents_user_companion
      ON companion_memory_documents(user_id, companion_id)
  `;

  // Trigger to auto-update updated_at
  await sql`
    CREATE OR REPLACE TRIGGER update_companion_memory_documents_updated_at
      BEFORE UPDATE ON companion_memory_documents
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at()
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS companion_memory_documents`;
}
