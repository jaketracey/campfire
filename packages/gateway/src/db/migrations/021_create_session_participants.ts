/**
 * Migration: Create Session Participants Table
 * Created: 2026-01-01
 *
 * Group chat support:
 * - session_participants: Join table for companions in a session
 *
 * Enables multiple companions to participate in a single session.
 * The primary companion is the original session companion, invited
 * companions can join/leave dynamically during the conversation.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Session Participants Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS session_participants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Session and companion references
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- Participation details
      role VARCHAR(20) NOT NULL DEFAULT 'invited',  -- 'primary' or 'invited'
      status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' or 'left'

      -- Who invited this companion (null for primary)
      invited_by_companion_id UUID REFERENCES companions(id) ON DELETE SET NULL,

      -- Timing
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,

      -- Per-session stats for this companion
      message_count INTEGER NOT NULL DEFAULT 0,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Each companion can only be in a session once
      CONSTRAINT session_participants_unique UNIQUE (session_id, companion_id),

      -- Role must be valid
      CONSTRAINT session_participants_role_valid CHECK (role IN ('primary', 'invited')),

      -- Status must be valid
      CONSTRAINT session_participants_status_valid CHECK (status IN ('active', 'left'))
    )
  `;

  // Index for getting all participants in a session
  await sql`
    CREATE INDEX IF NOT EXISTS idx_session_participants_session
    ON session_participants (session_id, status)
  `;

  // Index for getting active participants only
  await sql`
    CREATE INDEX IF NOT EXISTS idx_session_participants_active
    ON session_participants (session_id)
    WHERE status = 'active'
  `;

  // Index for getting all sessions a companion is in
  await sql`
    CREATE INDEX IF NOT EXISTS idx_session_participants_companion
    ON session_participants (companion_id, status)
  `;

  // Updated at trigger
  await sql`
    CREATE TRIGGER session_participants_updated_at
    BEFORE UPDATE ON session_participants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE session_participants IS 'Companions participating in a session for group chat support'
  `;

  await sql`
    COMMENT ON COLUMN session_participants.role IS 'primary = original session companion, invited = dynamically added friend'
  `;

  await sql`
    COMMENT ON COLUMN session_participants.invited_by_companion_id IS 'Which companion invited this one (null for primary)'
  `;

  // =========================================================================
  // Migrate Existing Sessions
  // =========================================================================
  // Create participant records for all existing sessions (as primary)
  await sql`
    INSERT INTO session_participants (session_id, companion_id, role, status, joined_at)
    SELECT
      id,
      companion_id,
      'primary',
      CASE WHEN status = 'ended' THEN 'left' ELSE 'active' END,
      started_at
    FROM sessions
    WHERE NOT EXISTS (
      SELECT 1 FROM session_participants sp
      WHERE sp.session_id = sessions.id
        AND sp.companion_id = sessions.companion_id
    )
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS session_participants_updated_at ON session_participants`;
  await sql`DROP INDEX IF EXISTS idx_session_participants_companion`;
  await sql`DROP INDEX IF EXISTS idx_session_participants_active`;
  await sql`DROP INDEX IF EXISTS idx_session_participants_session`;
  await sql`DROP TABLE IF EXISTS session_participants CASCADE`;
}
