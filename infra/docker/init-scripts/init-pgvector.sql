-- =============================================================================
-- PostgreSQL Initialization Script - Enable pgvector extension
-- =============================================================================
-- This script runs on first database initialization to set up required
-- extensions for the Campfire application.
-- =============================================================================

-- Enable pgvector extension for vector similarity search
-- Used for semantic search and knowledge graph embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Campfire database extensions initialized successfully';
END $$;
