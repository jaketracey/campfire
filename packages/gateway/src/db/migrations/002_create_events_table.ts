/**
 * Migration: Create Events Table (Event Store)
 * Created: 2026-01-01
 *
 * Core event sourcing table following the Event Envelope specification
 * from the Project Campfire plan (Section 5.1).
 *
 * Performance considerations:
 * - BRIN index on timestamp for time-range queries (efficient for append-only)
 * - B-tree indexes on user_id, session_id for user/session lookups
 * - Partial index on type for common event type queries
 * - Partitioning strategy: Range partition by month for scale
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Create custom types for event metadata
  await sql`
    DO $$ BEGIN
      CREATE TYPE event_cost AS (
        tokens_input INTEGER,
        tokens_output INTEGER,
        duration_ms INTEGER,
        cost_usd NUMERIC(12, 8)
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Main events table - partitioned by timestamp for scale
  // Using native PostgreSQL partitioning (range by month)
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      event_id UUID NOT NULL DEFAULT uuid_generate_v4(),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id UUID,
      session_id UUID,
      turn_id UUID,
      trace_id UUID,
      type VARCHAR(255) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      causation_id UUID,
      correlation_id UUID,
      cost JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Primary key includes timestamp for partitioning
      PRIMARY KEY (event_id, timestamp)
    ) PARTITION BY RANGE (timestamp)
  `;

  // Create default partition for current and future data
  await sql`
    CREATE TABLE IF NOT EXISTS events_default PARTITION OF events DEFAULT
  `;

  // Create partitions for recent months (example: last 3 months + current)
  // In production, use a cron job or function to create partitions ahead of time
  await sql`
    DO $$
    DECLARE
      partition_date DATE;
      partition_name TEXT;
      start_date DATE;
      end_date DATE;
    BEGIN
      -- Create partitions for current month and next 2 months
      FOR i IN 0..2 LOOP
        partition_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        partition_name := 'events_' || TO_CHAR(partition_date, 'YYYY_MM');
        start_date := partition_date;
        end_date := partition_date + INTERVAL '1 month';

        -- Check if partition exists
        IF NOT EXISTS (
          SELECT 1 FROM pg_class WHERE relname = partition_name
        ) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            start_date,
            end_date
          );
        END IF;
      END LOOP;
    END $$
  `;

  // Index for user-based queries (most common access pattern)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_user_id
    ON events (user_id, timestamp DESC)
    WHERE user_id IS NOT NULL
  `;

  // Index for session-based queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_session_id
    ON events (session_id, timestamp DESC)
    WHERE session_id IS NOT NULL
  `;

  // Index for trace correlation
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_trace_id
    ON events (trace_id)
    WHERE trace_id IS NOT NULL
  `;

  // Index for event type queries (partial index for common types)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_type
    ON events (type, timestamp DESC)
  `;

  // BRIN index for timestamp range scans (very efficient for append-only tables)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp_brin
    ON events USING BRIN (timestamp)
    WITH (pages_per_range = 32)
  `;

  // GIN index on payload for JSONB queries (if needed)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_payload
    ON events USING GIN (payload jsonb_path_ops)
  `;

  // Index for causation chain traversal
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_causation
    ON events (causation_id)
    WHERE causation_id IS NOT NULL
  `;

  // Composite index for user + type queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_events_user_type
    ON events (user_id, type, timestamp DESC)
    WHERE user_id IS NOT NULL
  `;

  // Add table comment
  await sql`
    COMMENT ON TABLE events IS 'Event store for Project Campfire - immutable append-only log of all system events'
  `;

  // Add column comments
  await sql`COMMENT ON COLUMN events.event_id IS 'Unique identifier for the event (UUID v4)'`;
  await sql`COMMENT ON COLUMN events.timestamp IS 'When the event occurred (used for partitioning)'`;
  await sql`COMMENT ON COLUMN events.user_id IS 'User who triggered or is affected by the event'`;
  await sql`COMMENT ON COLUMN events.session_id IS 'Session context for the event'`;
  await sql`COMMENT ON COLUMN events.turn_id IS 'Turn within a session (for conversation events)'`;
  await sql`COMMENT ON COLUMN events.trace_id IS 'OpenTelemetry trace ID for distributed tracing'`;
  await sql`COMMENT ON COLUMN events.type IS 'Event type identifier (e.g., session.started, llm.final)'`;
  await sql`COMMENT ON COLUMN events.payload IS 'Event-specific data as JSONB'`;
  await sql`COMMENT ON COLUMN events.version IS 'Schema version for the event type'`;
  await sql`COMMENT ON COLUMN events.causation_id IS 'Event that caused this event'`;
  await sql`COMMENT ON COLUMN events.correlation_id IS 'Links related events across services'`;
  await sql`COMMENT ON COLUMN events.cost IS 'Resource cost metadata (tokens, duration, USD)'`;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Drop partitions first
  await sql`
    DO $$
    DECLARE
      partition_name TEXT;
    BEGIN
      FOR partition_name IN
        SELECT inhrelid::regclass::text
        FROM pg_inherits
        WHERE inhparent = 'events'::regclass
      LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_name);
      END LOOP;
    END $$
  `;

  await sql`DROP TABLE IF EXISTS events CASCADE`;
  await sql`DROP TYPE IF EXISTS event_cost`;
}
