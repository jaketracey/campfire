/**
 * Migration: Add Companion ID to Turns
 * Created: 2026-01-01
 *
 * For group chat support, we need to track which companion
 * sent each agent_message in a turn. This enables:
 * - Displaying correct avatar/name per message
 * - Filtering conversation history by speaker
 * - Analytics on companion participation
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add companion_id column to turns table
  await sql`
    ALTER TABLE turns
    ADD COLUMN IF NOT EXISTS companion_id UUID REFERENCES companions(id) ON DELETE SET NULL
  `;

  // Index for filtering turns by companion within a session
  await sql`
    CREATE INDEX IF NOT EXISTS idx_turns_companion
    ON turns (session_id, companion_id)
    WHERE companion_id IS NOT NULL
  `;

  await sql`
    COMMENT ON COLUMN turns.companion_id IS 'Which companion sent the agent_message (null for legacy single-companion sessions)'
  `;

  // =========================================================================
  // Backfill existing turns with companion_id from session
  // =========================================================================
  // For existing turns, set companion_id to the session's companion_id
  await sql`
    UPDATE turns t
    SET companion_id = s.companion_id
    FROM sessions s
    WHERE t.session_id = s.id
      AND t.companion_id IS NULL
      AND t.agent_message IS NOT NULL
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_turns_companion`;
  await sql`ALTER TABLE turns DROP COLUMN IF EXISTS companion_id`;
}
