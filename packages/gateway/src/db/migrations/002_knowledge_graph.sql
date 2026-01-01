-- Knowledge Graph Tables Migration
-- Creates kg_entities and kg_edges tables for storing extracted entities and relationships

-- ============================================================================
-- KG Entities Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS kg_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    canonical_name VARCHAR(500) NOT NULL,
    entity_type VARCHAR(50) NOT NULL DEFAULT 'unknown',
    aliases TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    source_event_id UUID REFERENCES events(event_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint on canonical name per user/companion
CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_entities_canonical
    ON kg_entities(user_id, companion_id, canonical_name);

-- Index for searching entities
CREATE INDEX IF NOT EXISTS idx_kg_entities_user_companion
    ON kg_entities(user_id, companion_id);

CREATE INDEX IF NOT EXISTS idx_kg_entities_type
    ON kg_entities(entity_type);

CREATE INDEX IF NOT EXISTS idx_kg_entities_name_search
    ON kg_entities USING gin(to_tsvector('english', name));

-- ============================================================================
-- KG Edges Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS kg_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
    source_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    relation_type VARCHAR(50) NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'deprecated', 'deleted')),
    source_event_id UUID REFERENCES events(event_id) ON DELETE SET NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_confirmed TIMESTAMPTZ,
    mention_count INTEGER NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint to prevent duplicate edges
CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_edges_unique
    ON kg_edges(source_entity_id, target_entity_id, relation_type);

-- Index for traversal queries
CREATE INDEX IF NOT EXISTS idx_kg_edges_source
    ON kg_edges(source_entity_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_kg_edges_target
    ON kg_edges(target_entity_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_kg_edges_user_companion
    ON kg_edges(user_id, companion_id);

CREATE INDEX IF NOT EXISTS idx_kg_edges_relation
    ON kg_edges(relation_type);

-- ============================================================================
-- Memories Table (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type VARCHAR(20) NOT NULL DEFAULT 'fact' CHECK (content_type IN ('fact', 'preference', 'event', 'summary', 'reflection')),
    embedding vector(1536),
    importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
    source_event_id UUID REFERENCES events(event_id) ON DELETE SET NULL,
    source_turn_id UUID REFERENCES turns(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for memory queries
CREATE INDEX IF NOT EXISTS idx_memories_user_companion
    ON memories(user_id, companion_id);

CREATE INDEX IF NOT EXISTS idx_memories_content_type
    ON memories(content_type);

CREATE INDEX IF NOT EXISTS idx_memories_importance
    ON memories(importance DESC);

CREATE INDEX IF NOT EXISTS idx_memories_expiry
    ON memories(expires_at) WHERE expires_at IS NOT NULL;

-- Vector similarity index (requires pgvector extension)
CREATE INDEX IF NOT EXISTS idx_memories_embedding
    ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_kg_entities_updated_at ON kg_entities;
CREATE TRIGGER trigger_kg_entities_updated_at
    BEFORE UPDATE ON kg_entities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_kg_edges_updated_at ON kg_edges;
CREATE TRIGGER trigger_kg_edges_updated_at
    BEFORE UPDATE ON kg_edges
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_memories_updated_at ON memories;
CREATE TRIGGER trigger_memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
