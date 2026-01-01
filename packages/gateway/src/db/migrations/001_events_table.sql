-- Events table for append-only event store
-- This table stores all events in the system with proper indexing for queries

CREATE TABLE IF NOT EXISTS events (
    -- Auto-incrementing sequence for ordering
    sequence_number BIGSERIAL PRIMARY KEY,

    -- Event identity
    event_id UUID NOT NULL UNIQUE,

    -- Timestamps
    timestamp TIMESTAMPTZ NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Identity context
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT,

    -- Tracing
    trace_id TEXT NOT NULL,
    causation_id TEXT,
    correlation_id TEXT NOT NULL,

    -- Event data
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    version TEXT NOT NULL,

    -- Cost tracking (optional)
    cost JSONB
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events (user_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events (session_id);
CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
CREATE INDEX IF NOT EXISTS idx_events_stored_at ON events (stored_at);
CREATE INDEX IF NOT EXISTS idx_events_user_session ON events (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id);

-- Composite index for event streaming queries
CREATE INDEX IF NOT EXISTS idx_events_stream ON events (user_id, sequence_number);

-- Comment
COMMENT ON TABLE events IS 'Append-only event store for all system events';
