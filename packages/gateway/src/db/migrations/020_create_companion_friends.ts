/**
 * Migration: Create Companion Friends Table
 * Created: 2026-01-01
 *
 * Companion friendship system:
 * - companion_friends: Bidirectional friendship relationships between companions
 *
 * Friendships are stored as two rows (one per direction) to allow:
 * - Asymmetric metadata (how A describes B vs how B describes A)
 * - Simpler "get my friends" queries without OR clauses
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Companion Friends Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS companion_friends (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- The companion who owns this friendship record
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- The friend companion
      friend_companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- Friendship metadata
      relationship_type VARCHAR(50),  -- 'best_friend', 'rival', 'mentor', 'colleague', etc.
      how_they_met TEXT,              -- Narrative description
      nickname VARCHAR(100),          -- What this companion calls the friend

      -- Familiarity level (0-100) - affects conversation style
      familiarity_level INTEGER NOT NULL DEFAULT 50,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Prevent duplicate friendships
      CONSTRAINT companion_friends_unique UNIQUE (companion_id, friend_companion_id),

      -- Prevent self-friendship
      CONSTRAINT companion_friends_no_self CHECK (companion_id != friend_companion_id),

      -- Familiarity must be in valid range
      CONSTRAINT companion_friends_familiarity_range CHECK (familiarity_level >= 0 AND familiarity_level <= 100)
    )
  `;

  // Index for looking up a companion's friends
  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_friends_companion
    ON companion_friends (companion_id)
  `;

  // Index for reverse lookup (who has this companion as a friend)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_friends_friend
    ON companion_friends (friend_companion_id)
  `;

  // Updated at trigger
  await sql`
    CREATE TRIGGER companion_friends_updated_at
    BEFORE UPDATE ON companion_friends
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE companion_friends IS 'Companion-to-companion friendship relationships for group chat invitations'
  `;

  await sql`
    COMMENT ON COLUMN companion_friends.relationship_type IS 'Type of relationship: best_friend, rival, mentor, colleague, etc.'
  `;

  await sql`
    COMMENT ON COLUMN companion_friends.familiarity_level IS 'How well they know each other (0-100), affects conversation style'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS companion_friends_updated_at ON companion_friends`;
  await sql`DROP INDEX IF EXISTS idx_companion_friends_friend`;
  await sql`DROP INDEX IF EXISTS idx_companion_friends_companion`;
  await sql`DROP TABLE IF EXISTS companion_friends CASCADE`;
}
