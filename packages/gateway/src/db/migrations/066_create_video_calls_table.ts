/**
 * Migration: Create video_calls table for live video chat with AI companions
 * Created: 2026-03-26
 *
 * Stores video call sessions managed via LiveKit WebRTC.
 * Billing is per-second at 2 tokens/sec (double the voice rate).
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Create video call status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE video_call_status AS ENUM (
        'connecting',
        'active',
        'ending',
        'ended',
        'failed'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Create video_calls table
  await sql`
    CREATE TABLE IF NOT EXISTS video_calls (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      room_name VARCHAR(255) NOT NULL UNIQUE,
      status video_call_status NOT NULL DEFAULT 'connecting',
      avatar_provider VARCHAR(50) NOT NULL DEFAULT 'simli',
      avatar_face_id VARCHAR(255),
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      tokens_deducted INTEGER NOT NULL DEFAULT 0,
      cost_usd NUMERIC(10,6),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Indexes for common query patterns
  await sql`CREATE INDEX IF NOT EXISTS idx_video_calls_user_id ON video_calls(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_calls_companion_id ON video_calls(companion_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_calls_status ON video_calls(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_calls_room_name ON video_calls(room_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_video_calls_user_status ON video_calls(user_id, status) WHERE status IN ('connecting', 'active')`;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS video_calls`;
  await sql`DROP TYPE IF EXISTS video_call_status`;
}
