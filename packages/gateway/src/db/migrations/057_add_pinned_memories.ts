/**
 * Migration: Add Pinned Memories Support
 * Created: 2026-01-18
 *
 * Implements "Always-On Context" pattern from Character.AI best practices.
 * Pinned memories are always included in the prompt context, ensuring
 * the AI consistently remembers critical facts about the user/character.
 *
 * Features:
 * - is_pinned flag on memories table for user-pinned facts
 * - pinned_memories JSONB on companions for character-critical facts
 * - pin_order for controlling display order
 * - Limit enforcement (max 10 pinned per user-companion pair)
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Add is_pinned to memories table
  // =========================================================================
  await sql`
    ALTER TABLE memories
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE
  `;

  // Pin order for sorting pinned memories (lower = higher priority)
  await sql`
    ALTER TABLE memories
    ADD COLUMN IF NOT EXISTS pin_order INTEGER
  `;

  // Pinned at timestamp for tracking when it was pinned
  await sql`
    ALTER TABLE memories
    ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ
  `;

  // Index for efficiently querying pinned memories
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_pinned
    ON memories (user_id, companion_id, pin_order)
    WHERE is_pinned = TRUE AND status = 'active'
  `;

  await sql`
    COMMENT ON COLUMN memories.is_pinned IS 'Whether this memory is pinned (always included in context)'
  `;

  await sql`
    COMMENT ON COLUMN memories.pin_order IS 'Display order for pinned memories (lower = higher priority)'
  `;

  // =========================================================================
  // Add pinned_memories to companions table for character-critical facts
  // =========================================================================
  await sql`
    ALTER TABLE companions
    ADD COLUMN IF NOT EXISTS pinned_memories JSONB NOT NULL DEFAULT '[]'
  `;

  await sql`
    COMMENT ON COLUMN companions.pinned_memories IS 'Character-critical facts that should always be in context (max 10)'
  `;

  // =========================================================================
  // Helper functions for pinned memory management
  // =========================================================================

  // Function to get pinned memories for a user-companion pair
  await sql`
    CREATE OR REPLACE FUNCTION get_pinned_memories(
      p_user_id UUID,
      p_companion_id UUID,
      p_limit INTEGER DEFAULT 10
    )
    RETURNS TABLE (
      id UUID,
      content TEXT,
      content_type memory_content_type,
      importance REAL,
      pin_order INTEGER,
      pinned_at TIMESTAMPTZ,
      metadata JSONB
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        m.id,
        m.content,
        m.content_type,
        m.importance,
        m.pin_order,
        m.pinned_at,
        m.metadata
      FROM memories m
      WHERE m.user_id = p_user_id
        AND m.companion_id = p_companion_id
        AND m.is_pinned = TRUE
        AND m.status = 'active'
      ORDER BY COALESCE(m.pin_order, 999), m.pinned_at ASC
      LIMIT p_limit;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to pin a memory with automatic order assignment
  await sql`
    CREATE OR REPLACE FUNCTION pin_memory(
      p_memory_id UUID,
      p_user_id UUID,
      p_companion_id UUID
    )
    RETURNS BOOLEAN AS $$
    DECLARE
      v_pinned_count INTEGER;
      v_max_order INTEGER;
    BEGIN
      -- Check current pinned count (limit to 10)
      SELECT COUNT(*) INTO v_pinned_count
      FROM memories
      WHERE user_id = p_user_id
        AND companion_id = p_companion_id
        AND is_pinned = TRUE
        AND status = 'active';

      IF v_pinned_count >= 10 THEN
        RETURN FALSE; -- Cannot pin more than 10
      END IF;

      -- Get max current order
      SELECT COALESCE(MAX(pin_order), 0) INTO v_max_order
      FROM memories
      WHERE user_id = p_user_id
        AND companion_id = p_companion_id
        AND is_pinned = TRUE;

      -- Pin the memory
      UPDATE memories
      SET
        is_pinned = TRUE,
        pin_order = v_max_order + 1,
        pinned_at = NOW()
      WHERE id = p_memory_id
        AND user_id = p_user_id
        AND companion_id = p_companion_id;

      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to unpin a memory
  await sql`
    CREATE OR REPLACE FUNCTION unpin_memory(p_memory_id UUID)
    RETURNS VOID AS $$
    BEGIN
      UPDATE memories
      SET
        is_pinned = FALSE,
        pin_order = NULL,
        pinned_at = NULL
      WHERE id = p_memory_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to reorder pinned memories
  await sql`
    CREATE OR REPLACE FUNCTION reorder_pinned_memories(
      p_user_id UUID,
      p_companion_id UUID,
      p_memory_ids UUID[]
    )
    RETURNS VOID AS $$
    DECLARE
      v_memory_id UUID;
      v_order INTEGER := 1;
    BEGIN
      FOREACH v_memory_id IN ARRAY p_memory_ids
      LOOP
        UPDATE memories
        SET pin_order = v_order
        WHERE id = v_memory_id
          AND user_id = p_user_id
          AND companion_id = p_companion_id
          AND is_pinned = TRUE;
        v_order := v_order + 1;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS reorder_pinned_memories(UUID, UUID, UUID[])`;
  await sql`DROP FUNCTION IF EXISTS unpin_memory(UUID)`;
  await sql`DROP FUNCTION IF EXISTS pin_memory(UUID, UUID, UUID)`;
  await sql`DROP FUNCTION IF EXISTS get_pinned_memories(UUID, UUID, INTEGER)`;
  await sql`DROP INDEX IF EXISTS idx_memories_pinned`;
  await sql`ALTER TABLE companions DROP COLUMN IF EXISTS pinned_memories`;
  await sql`ALTER TABLE memories DROP COLUMN IF EXISTS pinned_at`;
  await sql`ALTER TABLE memories DROP COLUMN IF EXISTS pin_order`;
  await sql`ALTER TABLE memories DROP COLUMN IF EXISTS is_pinned`;
}
