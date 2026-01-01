/**
 * Migration: Create Memories Table with pgvector
 * Created: 2026-01-01
 *
 * Long-term memory storage with vector embeddings for semantic search.
 * Uses pgvector for efficient similarity search.
 *
 * Performance considerations:
 * - IVFFlat index for approximate nearest neighbor search
 * - HNSW index option for higher recall (commented, use if needed)
 * - Partial indexes for active memories
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Memory content type enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE memory_content_type AS ENUM ('fact', 'preference', 'event', 'summary', 'reflection');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Memory status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE memory_status AS ENUM ('active', 'archived', 'deleted');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Memories Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS memories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      content_type memory_content_type NOT NULL DEFAULT 'fact',
      status memory_status NOT NULL DEFAULT 'active',

      -- pgvector embedding (1536 dimensions for OpenAI text-embedding-ada-002)
      -- Use 3072 dimensions for text-embedding-3-large if needed
      embedding vector(1536),

      -- Importance score (0-1) for retrieval prioritization
      importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),

      -- Access tracking for decay/reinforcement
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,

      -- Provenance
      source_event_id UUID,
      source_turn_id UUID,

      -- Metadata
      metadata JSONB NOT NULL DEFAULT '{}',
      tags TEXT[] NOT NULL DEFAULT '{}',

      -- Temporal bounds
      valid_from TIMESTAMPTZ,
      valid_until TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // User + companion filter (most common query pattern)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_user_companion
    ON memories (user_id, companion_id)
    WHERE status = 'active'
  `;

  // Content type filtering
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_content_type
    ON memories (user_id, companion_id, content_type)
    WHERE status = 'active'
  `;

  // Importance-based retrieval
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_importance
    ON memories (user_id, companion_id, importance DESC)
    WHERE status = 'active'
  `;

  // Expiration cleanup
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_expires
    ON memories (expires_at)
    WHERE expires_at IS NOT NULL AND status = 'active'
  `;

  // Tags for categorical queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_tags
    ON memories USING GIN (tags)
    WHERE status = 'active'
  `;

  // Full-text search on content
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_content_fts
    ON memories USING GIN (to_tsvector('english', content))
    WHERE status = 'active'
  `;

  // Trigger for updated_at
  await sql`
    CREATE TRIGGER memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  // =========================================================================
  // Vector Similarity Index (IVFFlat)
  // IVFFlat is good for datasets up to ~1M vectors
  // For larger datasets, consider HNSW
  // =========================================================================

  // Note: Create the index after initial data load for better performance
  // The number of lists should be sqrt(n) where n is expected row count
  // Starting with 100 lists, adjust based on data volume
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_embedding_ivfflat
    ON memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
    WHERE embedding IS NOT NULL AND status = 'active'
  `;

  // Alternative: HNSW index for higher recall (use instead of IVFFlat if needed)
  // HNSW is better for smaller datasets or when high recall is critical
  // Uncomment if switching from IVFFlat:
  /*
  await sql`
    CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw
    ON memories USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding IS NOT NULL AND status = 'active'
  `;
  */

  await sql`
    COMMENT ON TABLE memories IS 'Long-term memory storage with vector embeddings for semantic retrieval'
  `;

  await sql`
    COMMENT ON COLUMN memories.embedding IS 'Vector embedding (1536d for ada-002) for semantic similarity search'
  `;

  await sql`
    COMMENT ON COLUMN memories.importance IS 'Importance score (0-1) for retrieval prioritization and decay'
  `;

  // =========================================================================
  // Helper Functions for Memory Operations
  // =========================================================================

  // Function to search memories by semantic similarity
  await sql`
    CREATE OR REPLACE FUNCTION search_memories_by_embedding(
      p_user_id UUID,
      p_companion_id UUID,
      p_embedding vector(1536),
      p_limit INTEGER DEFAULT 10,
      p_min_similarity REAL DEFAULT 0.7
    )
    RETURNS TABLE (
      id UUID,
      content TEXT,
      content_type memory_content_type,
      importance REAL,
      similarity REAL,
      metadata JSONB
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        m.id,
        m.content,
        m.content_type,
        m.importance,
        1 - (m.embedding <=> p_embedding) AS similarity,
        m.metadata
      FROM memories m
      WHERE m.user_id = p_user_id
        AND m.companion_id = p_companion_id
        AND m.status = 'active'
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> p_embedding) >= p_min_similarity
      ORDER BY m.embedding <=> p_embedding
      LIMIT p_limit;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to update memory access stats
  await sql`
    CREATE OR REPLACE FUNCTION record_memory_access(p_memory_id UUID)
    RETURNS VOID AS $$
    BEGIN
      UPDATE memories
      SET
        access_count = access_count + 1,
        last_accessed_at = NOW()
      WHERE id = p_memory_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to apply memory decay (reduce importance over time)
  await sql`
    CREATE OR REPLACE FUNCTION apply_memory_decay(
      p_user_id UUID,
      p_companion_id UUID,
      p_decay_rate REAL DEFAULT 0.01
    )
    RETURNS INTEGER AS $$
    DECLARE
      affected_count INTEGER;
    BEGIN
      UPDATE memories
      SET importance = GREATEST(0.1, importance * (1 - p_decay_rate))
      WHERE user_id = p_user_id
        AND companion_id = p_companion_id
        AND status = 'active'
        AND last_accessed_at < NOW() - INTERVAL '7 days';

      GET DIAGNOSTICS affected_count = ROW_COUNT;
      RETURN affected_count;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS apply_memory_decay(UUID, UUID, REAL)`;
  await sql`DROP FUNCTION IF EXISTS record_memory_access(UUID)`;
  await sql`DROP FUNCTION IF EXISTS search_memories_by_embedding(UUID, UUID, vector(1536), INTEGER, REAL)`;
  await sql`DROP TRIGGER IF EXISTS memories_updated_at ON memories`;
  await sql`DROP TABLE IF EXISTS memories CASCADE`;
  await sql`DROP TYPE IF EXISTS memory_status`;
  await sql`DROP TYPE IF EXISTS memory_content_type`;
}
