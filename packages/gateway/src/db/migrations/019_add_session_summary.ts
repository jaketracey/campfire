/**
 * Migration: Add Summary Column to Sessions Table
 * Created: 2026-01-01
 *
 * Adds a summary column to store AI-generated conversation summaries.
 * Used for maintaining context across long conversations and between sessions.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add summary column to sessions table
  await sql`
    ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS summary TEXT
  `;

  // Add summary_generated_at to track when summary was last updated
  await sql`
    ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMPTZ
  `;

  // Add index for sessions that need summaries (no summary but have turns)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_needs_summary
    ON sessions (user_id, companion_id, started_at DESC)
    WHERE summary IS NULL AND turn_count > 10
  `;

  await sql`
    COMMENT ON COLUMN sessions.summary IS 'AI-generated summary of the conversation for context retention'
  `;

  await sql`
    COMMENT ON COLUMN sessions.summary_generated_at IS 'When the summary was last generated/updated'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_sessions_needs_summary`;
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS summary_generated_at`;
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS summary`;
}
