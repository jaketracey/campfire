/**
 * Migration: Games framework — realtime WebSocket-based games.
 * Created: 2026-04-19
 *
 * Replaces the legacy `sessions.metadata.activeGame` blob with first-class
 * `game_sessions` and `game_moves` tables. Supports:
 *   - Server-authoritative state with optimistic locking (`version` column)
 *   - Per-move history for replay and commentary
 *   - Multiple game types (tic_tac_toe, chess, connect_four)
 *   - Concurrent games per chat session (service enforces one active at a time)
 */
import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      chat_session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      game_type VARCHAR(32) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'won', 'lost', 'draw', 'resigned')),
      current_player VARCHAR(16) NOT NULL DEFAULT 'user'
        CHECK (current_player IN ('user', 'companion')),
      winner VARCHAR(16)
        CHECK (winner IS NULL OR winner IN ('user', 'companion')),
      state JSONB NOT NULL,
      move_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      companion_symbol VARCHAR(8),
      user_symbol VARCHAR(8),
      difficulty VARCHAR(16),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_game_sessions_chat_session ON game_sessions(chat_session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_game_sessions_companion ON game_sessions(companion_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status)`;
  // At most one in-progress game per chat session (partial unique index)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_one_active_per_chat
      ON game_sessions(chat_session_id)
      WHERE status = 'in_progress'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS game_moves (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      game_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      player VARCHAR(16) NOT NULL CHECK (player IN ('user', 'companion')),
      notation TEXT NOT NULL,
      state_after JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game_session_id, seq)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_game_moves_session ON game_moves(game_session_id, seq)`;

  // Trigger to keep updated_at fresh on game_sessions
  await sql`
    CREATE OR REPLACE FUNCTION trg_game_sessions_set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    DROP TRIGGER IF EXISTS trg_game_sessions_updated_at ON game_sessions
  `;
  await sql`
    CREATE TRIGGER trg_game_sessions_updated_at
      BEFORE UPDATE ON game_sessions
      FOR EACH ROW EXECUTE FUNCTION trg_game_sessions_set_updated_at()
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_game_sessions_updated_at ON game_sessions`;
  await sql`DROP FUNCTION IF EXISTS trg_game_sessions_set_updated_at()`;
  await sql`DROP TABLE IF EXISTS game_moves`;
  await sql`DROP TABLE IF EXISTS game_sessions`;
}
