/**
 * Migration: Create Vault Projection Tables
 * Created: 2026-01-01
 *
 * Obsidian-style vault projection storage:
 * - vault_files: Rendered markdown files stored in S3
 * - vault_links: WikiLink relationships between files
 * - vault_render_queue: Queue for pending renders
 *
 * The vault is a projection derived from events (per plan.md Section 9).
 * It must be rebuildable deterministically.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Vault file type enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE vault_file_type AS ENUM (
        'conversation',
        'daily',
        'memory',
        'entity',
        'person',
        'companion',
        'index',
        'summary'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Render status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE render_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Vault Files Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS vault_files (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID REFERENCES companions(id) ON DELETE SET NULL,

      -- File path (e.g., "/Conversations/2026/01/01/session-abc.md")
      path VARCHAR(1024) NOT NULL,
      file_type vault_file_type NOT NULL,

      -- Content hashing for change detection
      content_hash VARCHAR(64) NOT NULL,

      -- S3 storage location
      s3_bucket VARCHAR(255) NOT NULL,
      s3_key VARCHAR(1024) NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,

      -- Frontmatter (extracted for indexing)
      title VARCHAR(255),
      frontmatter JSONB NOT NULL DEFAULT '{}',
      tags TEXT[] NOT NULL DEFAULT '{}',

      -- Provenance
      source_event_ids UUID[] NOT NULL DEFAULT '{}',
      source_session_id UUID,
      source_turn_ids UUID[] NOT NULL DEFAULT '{}',

      -- Version tracking
      version INTEGER NOT NULL DEFAULT 1,
      previous_version_id UUID,

      -- Render metadata
      last_rendered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      render_duration_ms INTEGER,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Unique path per user
      CONSTRAINT vault_files_path_unique UNIQUE (user_id, path)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_user_id
    ON vault_files (user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_user_companion
    ON vault_files (user_id, companion_id)
    WHERE companion_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_type
    ON vault_files (user_id, file_type)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_path
    ON vault_files (user_id, path)
  `;

  // Prefix search for path navigation
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_path_prefix
    ON vault_files (user_id, path varchar_pattern_ops)
  `;

  // Tags search
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_tags
    ON vault_files USING GIN (tags)
  `;

  // Frontmatter search
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_frontmatter
    ON vault_files USING GIN (frontmatter jsonb_path_ops)
  `;

  // Session-based lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_files_session
    ON vault_files (source_session_id)
    WHERE source_session_id IS NOT NULL
  `;

  await sql`
    CREATE TRIGGER vault_files_updated_at
    BEFORE UPDATE ON vault_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE vault_files IS 'Obsidian-style vault files (projections derived from events)'
  `;

  await sql`
    COMMENT ON COLUMN vault_files.path IS 'Vault-relative path (e.g., /Conversations/2026/01/01/session-abc.md)'
  `;

  await sql`
    COMMENT ON COLUMN vault_files.content_hash IS 'SHA-256 hash of file content for change detection'
  `;

  // =========================================================================
  // Vault Links Table (WikiLinks)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS vault_links (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Source file
      source_file_id UUID NOT NULL REFERENCES vault_files(id) ON DELETE CASCADE,
      source_path VARCHAR(1024) NOT NULL,

      -- Target (may not exist yet - forward reference)
      target_file_id UUID REFERENCES vault_files(id) ON DELETE SET NULL,
      target_path VARCHAR(1024) NOT NULL,

      -- Link metadata
      link_text VARCHAR(255),
      link_type VARCHAR(50) NOT NULL DEFAULT 'wikilink',
      context TEXT,

      -- Position in source file
      line_number INTEGER,
      column_number INTEGER,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT vault_links_unique UNIQUE (source_file_id, target_path, line_number)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_links_source
    ON vault_links (source_file_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_links_target
    ON vault_links (target_file_id)
    WHERE target_file_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_links_target_path
    ON vault_links (user_id, target_path)
  `;

  // Backlinks query (find all files linking to a target)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_links_backlinks
    ON vault_links (target_path, user_id)
  `;

  await sql`
    COMMENT ON TABLE vault_links IS 'WikiLink relationships between vault files'
  `;

  // Function to get backlinks for a file
  await sql`
    CREATE OR REPLACE FUNCTION get_backlinks(p_file_id UUID)
    RETURNS TABLE (
      source_file_id UUID,
      source_path VARCHAR,
      link_text VARCHAR,
      context TEXT
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        l.source_file_id,
        l.source_path,
        l.link_text,
        l.context
      FROM vault_links l
      WHERE l.target_file_id = p_file_id
      ORDER BY l.source_path;
    END;
    $$ LANGUAGE plpgsql STABLE
  `;

  // Function to update link targets when files are created
  await sql`
    CREATE OR REPLACE FUNCTION resolve_vault_links()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update any links pointing to this new file's path
      UPDATE vault_links
      SET target_file_id = NEW.id
      WHERE user_id = NEW.user_id
        AND target_path = NEW.path
        AND target_file_id IS NULL;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER vault_files_resolve_links
    AFTER INSERT ON vault_files
    FOR EACH ROW
    EXECUTE FUNCTION resolve_vault_links()
  `;

  // =========================================================================
  // Vault Render Queue Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS vault_render_queue (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- What to render
      render_type vault_file_type NOT NULL,
      target_path VARCHAR(1024),
      source_event_id UUID,
      source_session_id UUID,

      -- Priority and scheduling
      priority INTEGER NOT NULL DEFAULT 0,
      scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Processing state
      status render_status NOT NULL DEFAULT 'pending',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,

      -- Result
      result_file_id UUID REFERENCES vault_files(id) ON DELETE SET NULL,

      -- Deduplication
      idempotency_key VARCHAR(255),

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT vault_render_queue_idempotency UNIQUE (idempotency_key)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_render_queue_pending
    ON vault_render_queue (priority DESC, scheduled_at)
    WHERE status = 'pending'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_render_queue_user
    ON vault_render_queue (user_id, status)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_vault_render_queue_session
    ON vault_render_queue (source_session_id)
    WHERE source_session_id IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE vault_render_queue IS 'Queue for pending vault file renders (projection jobs)'
  `;

  // Function to enqueue a render job
  await sql`
    CREATE OR REPLACE FUNCTION enqueue_vault_render(
      p_user_id UUID,
      p_render_type vault_file_type,
      p_target_path VARCHAR DEFAULT NULL,
      p_source_event_id UUID DEFAULT NULL,
      p_source_session_id UUID DEFAULT NULL,
      p_priority INTEGER DEFAULT 0
    )
    RETURNS UUID AS $$
    DECLARE
      v_job_id UUID;
      v_idempotency_key VARCHAR;
    BEGIN
      -- Create idempotency key
      v_idempotency_key := p_user_id || ':' || p_render_type || ':' || COALESCE(p_target_path, '') || ':' || COALESCE(p_source_session_id::TEXT, '');

      -- Insert or update
      INSERT INTO vault_render_queue (
        user_id, render_type, target_path, source_event_id,
        source_session_id, priority, idempotency_key
      )
      VALUES (
        p_user_id, p_render_type, p_target_path, p_source_event_id,
        p_source_session_id, p_priority, v_idempotency_key
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET
        priority = GREATEST(vault_render_queue.priority, EXCLUDED.priority),
        scheduled_at = LEAST(vault_render_queue.scheduled_at, NOW())
      WHERE vault_render_queue.status = 'pending'
      RETURNING id INTO v_job_id;

      RETURN v_job_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to claim a render job
  await sql`
    CREATE OR REPLACE FUNCTION claim_vault_render_job(p_worker_id VARCHAR DEFAULT NULL)
    RETURNS TABLE (
      job_id UUID,
      user_id UUID,
      render_type vault_file_type,
      target_path VARCHAR,
      source_event_id UUID,
      source_session_id UUID
    ) AS $$
    DECLARE
      v_job_id UUID;
    BEGIN
      -- Claim the highest priority pending job
      UPDATE vault_render_queue
      SET
        status = 'processing',
        started_at = NOW()
      WHERE id = (
        SELECT id FROM vault_render_queue
        WHERE status = 'pending'
          AND scheduled_at <= NOW()
        ORDER BY priority DESC, scheduled_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING vault_render_queue.id INTO v_job_id;

      IF v_job_id IS NULL THEN
        RETURN;
      END IF;

      RETURN QUERY
      SELECT
        q.id,
        q.user_id,
        q.render_type,
        q.target_path,
        q.source_event_id,
        q.source_session_id
      FROM vault_render_queue q
      WHERE q.id = v_job_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Function to complete a render job
  await sql`
    CREATE OR REPLACE FUNCTION complete_vault_render_job(
      p_job_id UUID,
      p_result_file_id UUID DEFAULT NULL,
      p_error TEXT DEFAULT NULL
    )
    RETURNS VOID AS $$
    BEGIN
      UPDATE vault_render_queue
      SET
        status = CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,
        completed_at = NOW(),
        result_file_id = p_result_file_id,
        error = p_error
      WHERE id = p_job_id;
    END;
    $$ LANGUAGE plpgsql
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS complete_vault_render_job(UUID, UUID, TEXT)`;
  await sql`DROP FUNCTION IF EXISTS claim_vault_render_job(VARCHAR)`;
  await sql`DROP FUNCTION IF EXISTS enqueue_vault_render(UUID, vault_file_type, VARCHAR, UUID, UUID, INTEGER)`;
  await sql`DROP TABLE IF EXISTS vault_render_queue CASCADE`;
  await sql`DROP TRIGGER IF EXISTS vault_files_resolve_links ON vault_files`;
  await sql`DROP FUNCTION IF EXISTS resolve_vault_links()`;
  await sql`DROP FUNCTION IF EXISTS get_backlinks(UUID)`;
  await sql`DROP TABLE IF EXISTS vault_links CASCADE`;
  await sql`DROP TRIGGER IF EXISTS vault_files_updated_at ON vault_files`;
  await sql`DROP TABLE IF EXISTS vault_files CASCADE`;
  await sql`DROP TYPE IF EXISTS render_status`;
  await sql`DROP TYPE IF EXISTS vault_file_type`;
}
