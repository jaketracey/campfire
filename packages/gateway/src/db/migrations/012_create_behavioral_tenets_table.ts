/**
 * Migration: Create Behavioral Tenets Table
 * Created: 2026-01-01
 *
 * Behavioral tenets are rules that govern companion behavior:
 * - Core tenets: Always included in system prompt (max 5 per companion)
 * - Situational tenets: Retrieved dynamically based on conversation context
 *
 * Features:
 * - Vector embeddings for semantic search
 * - Trigger contexts for keyword matching
 * - Category and priority classification
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Tenet category enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE tenet_category AS ENUM (
        'communication',
        'boundaries',
        'engagement',
        'emotional',
        'knowledge',
        'autonomy'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Tenet priority enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE tenet_priority AS ENUM ('core', 'situational');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Behavioral Tenets Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS behavioral_tenets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Tenet definition
      category tenet_category NOT NULL,
      priority tenet_priority NOT NULL DEFAULT 'situational',
      rule TEXT NOT NULL CHECK (length(rule) >= 10 AND length(rule) <= 500),
      description TEXT CHECK (description IS NULL OR length(description) <= 200),
      is_negation BOOLEAN NOT NULL DEFAULT FALSE,

      -- Retrieval context
      trigger_contexts TEXT[] NOT NULL DEFAULT '{}',
      embedding vector(1536),

      -- Provenance
      source_event_id UUID,

      -- Status
      is_active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // =========================================================================
  // Indexes
  // =========================================================================

  // Index for fetching core tenets (always in system prompt)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenets_companion_core
    ON behavioral_tenets (companion_id)
    WHERE priority = 'core' AND is_active = TRUE
  `;

  // Index for companion + priority queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenets_companion_priority
    ON behavioral_tenets (companion_id, priority)
    WHERE is_active = TRUE
  `;

  // Index for category filtering
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenets_companion_category
    ON behavioral_tenets (companion_id, category)
    WHERE is_active = TRUE
  `;

  // GIN index for trigger context keyword matching
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenets_trigger_contexts
    ON behavioral_tenets USING GIN (trigger_contexts)
  `;

  // Vector index for semantic search on situational tenets
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenets_embedding
    ON behavioral_tenets USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
    WHERE embedding IS NOT NULL
  `;

  // Updated_at trigger
  await sql`
    CREATE TRIGGER behavioral_tenets_updated_at
    BEFORE UPDATE ON behavioral_tenets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  // Table comments
  await sql`
    COMMENT ON TABLE behavioral_tenets IS 'Behavioral rules that govern companion responses and personality'
  `;

  await sql`
    COMMENT ON COLUMN behavioral_tenets.priority IS 'Core tenets always in prompt; situational retrieved dynamically'
  `;

  await sql`
    COMMENT ON COLUMN behavioral_tenets.is_negation IS 'True for restrictions (Never do X) vs affirmations (Always do X)'
  `;

  await sql`
    COMMENT ON COLUMN behavioral_tenets.trigger_contexts IS 'Keywords that trigger retrieval for situational tenets'
  `;

  await sql`
    COMMENT ON COLUMN behavioral_tenets.embedding IS 'Vector embedding for semantic similarity search'
  `;

  // =========================================================================
  // Helper Functions
  // =========================================================================

  // Function to get core tenets for system prompt
  await sql`
    CREATE OR REPLACE FUNCTION get_core_tenets(p_companion_id UUID)
    RETURNS TABLE (
      id UUID,
      category tenet_category,
      rule TEXT,
      is_negation BOOLEAN
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT t.id, t.category, t.rule, t.is_negation
      FROM behavioral_tenets t
      WHERE t.companion_id = p_companion_id
        AND t.priority = 'core'
        AND t.is_active = TRUE
      ORDER BY t.category, t.created_at;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to search situational tenets by context and/or semantic similarity
  await sql`
    CREATE OR REPLACE FUNCTION search_situational_tenets(
      p_companion_id UUID,
      p_query_embedding vector(1536) DEFAULT NULL,
      p_contexts TEXT[] DEFAULT '{}',
      p_limit INTEGER DEFAULT 5
    )
    RETURNS TABLE (
      id UUID,
      category tenet_category,
      rule TEXT,
      is_negation BOOLEAN,
      match_type TEXT,
      similarity REAL
    ) AS $$
    BEGIN
      RETURN QUERY
      WITH context_matches AS (
        -- First priority: tenets matching trigger contexts
        SELECT
          t.id,
          t.category,
          t.rule,
          t.is_negation,
          'context'::TEXT AS match_type,
          1.0::REAL AS similarity
        FROM behavioral_tenets t
        WHERE t.companion_id = p_companion_id
          AND t.priority = 'situational'
          AND t.is_active = TRUE
          AND cardinality(p_contexts) > 0
          AND t.trigger_contexts && p_contexts
      ),
      semantic_matches AS (
        -- Second priority: semantic similarity matches
        SELECT
          t.id,
          t.category,
          t.rule,
          t.is_negation,
          'semantic'::TEXT AS match_type,
          (1 - (t.embedding <=> p_query_embedding))::REAL AS similarity
        FROM behavioral_tenets t
        WHERE t.companion_id = p_companion_id
          AND t.priority = 'situational'
          AND t.is_active = TRUE
          AND t.embedding IS NOT NULL
          AND p_query_embedding IS NOT NULL
          AND t.id NOT IN (SELECT cm.id FROM context_matches cm)
        ORDER BY t.embedding <=> p_query_embedding
        LIMIT p_limit
      )
      SELECT * FROM context_matches
      UNION ALL
      SELECT * FROM semantic_matches
      ORDER BY
        CASE match_type WHEN 'context' THEN 0 ELSE 1 END,
        similarity DESC
      LIMIT p_limit;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to count core tenets for a companion (for validation)
  await sql`
    CREATE OR REPLACE FUNCTION count_core_tenets(p_companion_id UUID)
    RETURNS INTEGER AS $$
    DECLARE
      v_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_count
      FROM behavioral_tenets
      WHERE companion_id = p_companion_id
        AND priority = 'core'
        AND is_active = TRUE;
      RETURN v_count;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Trigger to enforce max 5 core tenets
  await sql`
    CREATE OR REPLACE FUNCTION check_core_tenet_limit()
    RETURNS TRIGGER AS $$
    DECLARE
      v_count INTEGER;
    BEGIN
      IF NEW.priority = 'core' AND NEW.is_active = TRUE THEN
        SELECT COUNT(*) INTO v_count
        FROM behavioral_tenets
        WHERE companion_id = NEW.companion_id
          AND priority = 'core'
          AND is_active = TRUE
          AND id != COALESCE(NEW.id, uuid_nil());

        IF v_count >= 5 THEN
          RAISE EXCEPTION 'Maximum of 5 core tenets allowed per companion';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER behavioral_tenets_check_core_limit
    BEFORE INSERT OR UPDATE OF priority, is_active ON behavioral_tenets
    FOR EACH ROW
    EXECUTE FUNCTION check_core_tenet_limit()
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS behavioral_tenets_check_core_limit ON behavioral_tenets`;
  await sql`DROP FUNCTION IF EXISTS check_core_tenet_limit()`;
  await sql`DROP FUNCTION IF EXISTS count_core_tenets(UUID)`;
  await sql`DROP FUNCTION IF EXISTS search_situational_tenets(UUID, vector(1536), TEXT[], INTEGER)`;
  await sql`DROP FUNCTION IF EXISTS get_core_tenets(UUID)`;
  await sql`DROP TRIGGER IF EXISTS behavioral_tenets_updated_at ON behavioral_tenets`;
  await sql`DROP TABLE IF EXISTS behavioral_tenets CASCADE`;
  await sql`DROP TYPE IF EXISTS tenet_priority`;
  await sql`DROP TYPE IF EXISTS tenet_category`;
}
