/**
 * Migration: Companion Images
 * Created: 2026-01-01
 *
 * Creates table for storing generated companion image metadata.
 * Images are stored in S3, this table tracks metadata and enables gallery feature.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS companion_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      companion_id TEXT,
      s3_key TEXT NOT NULL,
      s3_url TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      format TEXT NOT NULL DEFAULT 'png',
      size_bytes INTEGER,
      emotional_state TEXT NOT NULL,
      style TEXT NOT NULL,
      prompt TEXT,
      cache_key TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'fal',
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, session_id, cache_key)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_companion_images_user_id ON companion_images (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_companion_images_session_id ON companion_images (session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_companion_images_user_session ON companion_images (user_id, session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_companion_images_created_at ON companion_images (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_companion_images_emotional_state ON companion_images (emotional_state)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_companion_images_cache_key ON companion_images (cache_key)`;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS companion_images`;
}
