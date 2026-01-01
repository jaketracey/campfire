/**
 * Migration: Create Knowledge Graph Tables
 * Created: 2026-01-01
 *
 * Knowledge graph for structured user information from the agent's perspective:
 * - kg_entities: Named entities (people, places, concepts, etc.)
 * - kg_edges: Relationships between entities with provenance
 *
 * Following the KG Rules from plan.md Section 10:
 * - Full provenance (source_event_id)
 * - Confidence scores
 * - Temporal tracking (first_seen, last_seen, last_confirmed)
 * - Status lifecycle (proposed -> active -> deprecated)
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // KG edge status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE kg_edge_status AS ENUM ('proposed', 'active', 'deprecated', 'deleted');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // KG Entities Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS kg_entities (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- Entity identification
      name VARCHAR(255) NOT NULL,
      canonical_name VARCHAR(255) NOT NULL,
      entity_type VARCHAR(100) NOT NULL,

      -- Aliases for entity resolution
      aliases TEXT[] NOT NULL DEFAULT '{}',

      -- Entity metadata
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',

      -- Provenance
      source_event_id UUID,
      first_mentioned_turn_id UUID,

      -- Statistics
      mention_count INTEGER NOT NULL DEFAULT 1,
      edge_count INTEGER NOT NULL DEFAULT 0,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Prevent duplicate canonical names per user+companion
      CONSTRAINT kg_entities_canonical_unique UNIQUE (user_id, companion_id, canonical_name)
    )
  `;

  // Index for user+companion entity lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_entities_user_companion
    ON kg_entities (user_id, companion_id)
  `;

  // Index for entity type filtering
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_entities_type
    ON kg_entities (user_id, companion_id, entity_type)
  `;

  // GIN index for alias lookups (entity resolution)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_entities_aliases
    ON kg_entities USING GIN (aliases)
  `;

  // Trigram index for fuzzy name matching
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_entities_name_trgm
    ON kg_entities USING GIN (name gin_trgm_ops)
  `;

  // Full-text search on name and description
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_entities_fts
    ON kg_entities USING GIN (
      to_tsvector('english', name || ' ' || COALESCE(description, ''))
    )
  `;

  await sql`
    CREATE TRIGGER kg_entities_updated_at
    BEFORE UPDATE ON kg_entities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE kg_entities IS 'Named entities in the knowledge graph (people, places, concepts, etc.)'
  `;

  await sql`
    COMMENT ON COLUMN kg_entities.canonical_name IS 'Normalized name for deduplication (lowercase, trimmed)'
  `;

  await sql`
    COMMENT ON COLUMN kg_entities.aliases IS 'Alternative names/spellings that resolve to this entity'
  `;

  // Function to normalize entity names
  await sql`
    CREATE OR REPLACE FUNCTION normalize_entity_name(name VARCHAR)
    RETURNS VARCHAR AS $$
    BEGIN
      RETURN LOWER(TRIM(REGEXP_REPLACE(name, '\\s+', ' ', 'g')));
    END;
    $$ LANGUAGE plpgsql IMMUTABLE
  `;

  // Trigger to auto-set canonical_name
  await sql`
    CREATE OR REPLACE FUNCTION set_canonical_entity_name()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.canonical_name IS NULL OR NEW.canonical_name = '' THEN
        NEW.canonical_name = normalize_entity_name(NEW.name);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER kg_entities_set_canonical
    BEFORE INSERT OR UPDATE OF name ON kg_entities
    FOR EACH ROW
    EXECUTE FUNCTION set_canonical_entity_name()
  `;

  // =========================================================================
  // KG Edges Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS kg_edges (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- Relationship endpoints
      source_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
      target_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,

      -- Relationship type (e.g., "works_at", "married_to", "lives_in")
      relation_type VARCHAR(100) NOT NULL,

      -- Confidence and status
      confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
      status kg_edge_status NOT NULL DEFAULT 'proposed',

      -- Provenance
      source_event_id UUID,
      source_turn_id UUID,

      -- Temporal tracking
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_confirmed TIMESTAMPTZ,

      -- Statistics
      mention_count INTEGER NOT NULL DEFAULT 1,

      -- Additional data
      metadata JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Prevent duplicate edges (same source, target, relation)
      CONSTRAINT kg_edges_unique UNIQUE (user_id, companion_id, source_entity_id, target_entity_id, relation_type)
    )
  `;

  // Index for entity relationship lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_edges_source
    ON kg_edges (source_entity_id)
    WHERE status = 'active'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_edges_target
    ON kg_edges (target_entity_id)
    WHERE status = 'active'
  `;

  // Index for user+companion graph traversal
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_edges_user_companion
    ON kg_edges (user_id, companion_id)
    WHERE status = 'active'
  `;

  // Index for relation type queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_edges_relation
    ON kg_edges (user_id, companion_id, relation_type)
    WHERE status = 'active'
  `;

  // Index for status filtering (proposed edges for review)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_edges_status
    ON kg_edges (user_id, companion_id, status)
    WHERE status = 'proposed'
  `;

  // Index for confidence-based queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_kg_edges_confidence
    ON kg_edges (user_id, companion_id, confidence DESC)
    WHERE status = 'active'
  `;

  await sql`
    CREATE TRIGGER kg_edges_updated_at
    BEFORE UPDATE ON kg_edges
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE kg_edges IS 'Relationships between entities with provenance and temporal tracking'
  `;

  await sql`
    COMMENT ON COLUMN kg_edges.confidence IS 'Confidence score (0-1) for the relationship'
  `;

  await sql`
    COMMENT ON COLUMN kg_edges.status IS 'Lifecycle status: proposed -> active -> deprecated -> deleted'
  `;

  await sql`
    COMMENT ON COLUMN kg_edges.last_confirmed IS 'Last time the relationship was explicitly confirmed by context'
  `;

  // Trigger to update entity edge counts
  await sql`
    CREATE OR REPLACE FUNCTION update_entity_edge_count()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        UPDATE kg_entities SET edge_count = edge_count + 1 WHERE id = NEW.source_entity_id;
        UPDATE kg_entities SET edge_count = edge_count + 1 WHERE id = NEW.target_entity_id;
      ELSIF TG_OP = 'DELETE' THEN
        UPDATE kg_entities SET edge_count = edge_count - 1 WHERE id = OLD.source_entity_id;
        UPDATE kg_entities SET edge_count = edge_count - 1 WHERE id = OLD.target_entity_id;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER kg_edges_update_entity_count
    AFTER INSERT OR DELETE ON kg_edges
    FOR EACH ROW
    EXECUTE FUNCTION update_entity_edge_count()
  `;

  // =========================================================================
  // Helper Functions for KG Operations
  // =========================================================================

  // Function to find or create an entity
  await sql`
    CREATE OR REPLACE FUNCTION find_or_create_entity(
      p_user_id UUID,
      p_companion_id UUID,
      p_name VARCHAR,
      p_entity_type VARCHAR,
      p_source_event_id UUID DEFAULT NULL
    )
    RETURNS UUID AS $$
    DECLARE
      v_canonical_name VARCHAR;
      v_entity_id UUID;
    BEGIN
      v_canonical_name := normalize_entity_name(p_name);

      -- Try to find existing entity
      SELECT id INTO v_entity_id
      FROM kg_entities
      WHERE user_id = p_user_id
        AND companion_id = p_companion_id
        AND (canonical_name = v_canonical_name OR v_canonical_name = ANY(aliases));

      IF v_entity_id IS NOT NULL THEN
        -- Update mention count
        UPDATE kg_entities
        SET mention_count = mention_count + 1
        WHERE id = v_entity_id;

        RETURN v_entity_id;
      END IF;

      -- Create new entity
      INSERT INTO kg_entities (user_id, companion_id, name, canonical_name, entity_type, source_event_id)
      VALUES (p_user_id, p_companion_id, p_name, v_canonical_name, p_entity_type, p_source_event_id)
      RETURNING id INTO v_entity_id;

      RETURN v_entity_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to propose a new edge
  await sql`
    CREATE OR REPLACE FUNCTION propose_kg_edge(
      p_user_id UUID,
      p_companion_id UUID,
      p_source_entity_id UUID,
      p_target_entity_id UUID,
      p_relation_type VARCHAR,
      p_confidence REAL DEFAULT 0.5,
      p_source_event_id UUID DEFAULT NULL
    )
    RETURNS UUID AS $$
    DECLARE
      v_edge_id UUID;
    BEGIN
      -- Check if edge already exists
      SELECT id INTO v_edge_id
      FROM kg_edges
      WHERE user_id = p_user_id
        AND companion_id = p_companion_id
        AND source_entity_id = p_source_entity_id
        AND target_entity_id = p_target_entity_id
        AND relation_type = p_relation_type;

      IF v_edge_id IS NOT NULL THEN
        -- Update existing edge
        UPDATE kg_edges
        SET
          last_seen = NOW(),
          mention_count = mention_count + 1,
          confidence = LEAST(1.0, confidence + 0.1)
        WHERE id = v_edge_id;

        RETURN v_edge_id;
      END IF;

      -- Create new proposed edge
      INSERT INTO kg_edges (
        user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id
      )
      VALUES (
        p_user_id, p_companion_id, p_source_entity_id, p_target_entity_id,
        p_relation_type, p_confidence, 'proposed', p_source_event_id
      )
      RETURNING id INTO v_edge_id;

      RETURN v_edge_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to promote an edge to active
  await sql`
    CREATE OR REPLACE FUNCTION promote_kg_edge(p_edge_id UUID)
    RETURNS VOID AS $$
    BEGIN
      UPDATE kg_edges
      SET
        status = 'active',
        last_confirmed = NOW()
      WHERE id = p_edge_id AND status = 'proposed';
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to get entity relationships
  await sql`
    CREATE OR REPLACE FUNCTION get_entity_relationships(
      p_entity_id UUID,
      p_direction VARCHAR DEFAULT 'both'
    )
    RETURNS TABLE (
      edge_id UUID,
      related_entity_id UUID,
      related_entity_name VARCHAR,
      relation_type VARCHAR,
      direction VARCHAR,
      confidence REAL
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        e.id AS edge_id,
        CASE
          WHEN e.source_entity_id = p_entity_id THEN e.target_entity_id
          ELSE e.source_entity_id
        END AS related_entity_id,
        ent.name AS related_entity_name,
        e.relation_type,
        CASE
          WHEN e.source_entity_id = p_entity_id THEN 'outgoing'::VARCHAR
          ELSE 'incoming'::VARCHAR
        END AS direction,
        e.confidence
      FROM kg_edges e
      JOIN kg_entities ent ON ent.id = CASE
        WHEN e.source_entity_id = p_entity_id THEN e.target_entity_id
        ELSE e.source_entity_id
      END
      WHERE e.status = 'active'
        AND (
          (p_direction = 'both' AND (e.source_entity_id = p_entity_id OR e.target_entity_id = p_entity_id))
          OR (p_direction = 'outgoing' AND e.source_entity_id = p_entity_id)
          OR (p_direction = 'incoming' AND e.target_entity_id = p_entity_id)
        )
      ORDER BY e.confidence DESC;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS get_entity_relationships(UUID, VARCHAR)`;
  await sql`DROP FUNCTION IF EXISTS promote_kg_edge(UUID)`;
  await sql`DROP FUNCTION IF EXISTS propose_kg_edge(UUID, UUID, UUID, UUID, VARCHAR, REAL, UUID)`;
  await sql`DROP FUNCTION IF EXISTS find_or_create_entity(UUID, UUID, VARCHAR, VARCHAR, UUID)`;
  await sql`DROP TRIGGER IF EXISTS kg_edges_update_entity_count ON kg_edges`;
  await sql`DROP FUNCTION IF EXISTS update_entity_edge_count()`;
  await sql`DROP TRIGGER IF EXISTS kg_edges_updated_at ON kg_edges`;
  await sql`DROP TABLE IF EXISTS kg_edges CASCADE`;
  await sql`DROP TRIGGER IF EXISTS kg_entities_set_canonical ON kg_entities`;
  await sql`DROP FUNCTION IF EXISTS set_canonical_entity_name()`;
  await sql`DROP FUNCTION IF EXISTS normalize_entity_name(VARCHAR)`;
  await sql`DROP TRIGGER IF EXISTS kg_entities_updated_at ON kg_entities`;
  await sql`DROP TABLE IF EXISTS kg_entities CASCADE`;
  await sql`DROP TYPE IF EXISTS kg_edge_status`;
}
