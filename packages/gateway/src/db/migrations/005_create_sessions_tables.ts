/**
 * Migration: Create Session and Turn Tables
 * Created: 2026-01-01
 *
 * Conversation session management:
 * - sessions: Active conversation sessions between users and companions
 * - turns: Individual conversation turns within sessions
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Session status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE session_status AS ENUM ('active', 'paused', 'ended', 'error');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Message type enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE message_type AS ENUM ('text', 'audio', 'image', 'multimodal');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Sessions Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      status session_status NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      turn_count INTEGER NOT NULL DEFAULT 0,
      total_tokens_input INTEGER NOT NULL DEFAULT 0,
      total_tokens_output INTEGER NOT NULL DEFAULT 0,
      total_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions (user_id, started_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_companion_id
    ON sessions (companion_id, started_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_companion
    ON sessions (user_id, companion_id, started_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_status
    ON sessions (status)
    WHERE status = 'active'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
    ON sessions (last_activity_at DESC)
    WHERE status = 'active'
  `;

  await sql`
    CREATE TRIGGER sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE sessions IS 'Conversation sessions between users and AI companions'
  `;

  // =========================================================================
  // Turns Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS turns (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_number INTEGER NOT NULL,
      user_message TEXT,
      user_message_type message_type NOT NULL DEFAULT 'text',
      user_audio_url VARCHAR(2048),
      user_image_urls TEXT[],
      agent_message TEXT,
      agent_message_type message_type NOT NULL DEFAULT 'text',
      agent_audio_url VARCHAR(2048),
      agent_image_urls TEXT[],
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      latency_ms INTEGER,
      stt_latency_ms INTEGER,
      llm_latency_ms INTEGER,
      tts_latency_ms INTEGER,
      token_count_input INTEGER,
      token_count_output INTEGER,
      cost_usd NUMERIC(12, 8),
      model_used VARCHAR(100),
      prompt_version VARCHAR(50),
      safety_flags JSONB,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT turns_session_number_unique UNIQUE (session_id, turn_number)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_turns_session_id
    ON turns (session_id, turn_number)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_turns_session_recent
    ON turns (session_id, created_at DESC)
  `;

  // Partial index for incomplete turns (useful for recovery)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_turns_incomplete
    ON turns (session_id)
    WHERE completed_at IS NULL
  `;

  await sql`
    COMMENT ON TABLE turns IS 'Individual conversation turns within a session'
  `;

  await sql`
    COMMENT ON COLUMN turns.latency_ms IS 'Total end-to-end latency for the turn'
  `;

  await sql`
    COMMENT ON COLUMN turns.prompt_version IS 'Version of the prompt template used'
  `;

  await sql`
    COMMENT ON COLUMN turns.safety_flags IS 'Safety classifications and flags applied to this turn'
  `;

  // Trigger to update session stats on turn completion
  await sql`
    CREATE OR REPLACE FUNCTION update_session_stats()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
        UPDATE sessions
        SET
          turn_count = turn_count + 1,
          total_tokens_input = total_tokens_input + COALESCE(NEW.token_count_input, 0),
          total_tokens_output = total_tokens_output + COALESCE(NEW.token_count_output, 0),
          total_cost_usd = total_cost_usd + COALESCE(NEW.cost_usd, 0),
          total_duration_ms = total_duration_ms + COALESCE(NEW.latency_ms, 0),
          last_activity_at = NEW.completed_at
        WHERE id = NEW.session_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER turns_update_session_stats
    AFTER UPDATE OF completed_at ON turns
    FOR EACH ROW
    EXECUTE FUNCTION update_session_stats()
  `;

  // Function to get the next turn number
  await sql`
    CREATE OR REPLACE FUNCTION get_next_turn_number(p_session_id UUID)
    RETURNS INTEGER AS $$
    DECLARE
      next_num INTEGER;
    BEGIN
      SELECT COALESCE(MAX(turn_number), 0) + 1
      INTO next_num
      FROM turns
      WHERE session_id = p_session_id;

      RETURN next_num;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS get_next_turn_number(UUID)`;
  await sql`DROP TRIGGER IF EXISTS turns_update_session_stats ON turns`;
  await sql`DROP FUNCTION IF EXISTS update_session_stats()`;
  await sql`DROP TABLE IF EXISTS turns CASCADE`;
  await sql`DROP TRIGGER IF EXISTS sessions_updated_at ON sessions`;
  await sql`DROP TABLE IF EXISTS sessions CASCADE`;
  await sql`DROP TYPE IF EXISTS message_type`;
  await sql`DROP TYPE IF EXISTS session_status`;
}
