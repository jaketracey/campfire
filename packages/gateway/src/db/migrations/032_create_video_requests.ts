/**
 * Migration: Create Video Requests Tables
 *
 * Creates the video_requests table for tracking user video generation requests.
 * Videos are generated via ComfyUI + AnimateDiff and cost 100 tokens.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Create video request status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE video_request_status AS ENUM (
        'pending',     -- Queued, not yet processing
        'generating',  -- ComfyUI is generating
        'encoding',    -- Post-processing/encoding
        'ready',       -- Complete, video available
        'failed'       -- Generation failed
      );
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `;

  // Create video_requests table
  await sql`
    CREATE TABLE IF NOT EXISTS video_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,

      -- Request details
      prompt TEXT NOT NULL,
      generated_prompt TEXT,

      -- Video specifications
      duration_seconds INTEGER NOT NULL DEFAULT 4,
      width INTEGER NOT NULL DEFAULT 512,
      height INTEGER NOT NULL DEFAULT 768,
      fps INTEGER NOT NULL DEFAULT 8,

      -- Storage
      s3_bucket TEXT,
      s3_key TEXT,
      video_url TEXT,
      thumbnail_s3_key TEXT,
      thumbnail_url TEXT,
      file_size_bytes INTEGER,

      -- Processing
      status video_request_status NOT NULL DEFAULT 'pending',
      token_cost INTEGER NOT NULL DEFAULT 100,
      generation_params JSONB,
      generation_error TEXT,
      processing_time_ms INTEGER,

      -- Tracking
      source_turn_id UUID REFERENCES turns(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;

  // Create indexes for common queries
  await sql`CREATE INDEX IF NOT EXISTS idx_video_requests_user_id ON video_requests(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_requests_companion_id ON video_requests(companion_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_requests_status ON video_requests(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_requests_created_at ON video_requests(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_requests_user_status ON video_requests(user_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_requests_user_created ON video_requests(user_id, created_at DESC)`;

  // Create updated_at trigger
  await sql`
    CREATE OR REPLACE FUNCTION update_video_requests_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DROP TRIGGER IF EXISTS trigger_video_requests_updated_at ON video_requests
  `;

  await sql`
    CREATE TRIGGER trigger_video_requests_updated_at
      BEFORE UPDATE ON video_requests
      FOR EACH ROW
      EXECUTE FUNCTION update_video_requests_updated_at()
  `;

  // Add comment
  await sql`
    COMMENT ON TABLE video_requests IS 'Stores user video generation requests for companion video messages'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trigger_video_requests_updated_at ON video_requests`;
  await sql`DROP FUNCTION IF EXISTS update_video_requests_updated_at()`;
  await sql`DROP TABLE IF EXISTS video_requests`;
  await sql`DROP TYPE IF EXISTS video_request_status`;
}
