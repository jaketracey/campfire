/**
 * Migration: Create companion_emotional_states table
 * Created: 2026-03-26
 *
 * Stores persistent emotional state per companion-user pair.
 * Updated after each conversation turn and decayed over time.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS companion_emotional_states (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      primary_emotion VARCHAR(50) NOT NULL DEFAULT 'trust',
      secondary_emotion VARCHAR(50),
      valence REAL NOT NULL DEFAULT 0.0,
      arousal REAL NOT NULL DEFAULT 0.0,
      dominance REAL NOT NULL DEFAULT 0.0,
      intensity REAL NOT NULL DEFAULT 0.5,
      stability REAL NOT NULL DEFAULT 0.7,
      triggers TEXT[] NOT NULL DEFAULT '{}',
      mood_description TEXT NOT NULL DEFAULT 'feeling balanced and attentive',
      transition_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(companion_id, user_id)
    )
  `;

  // Index on updated_at for time-decay batch queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emotional_states_updated_at
      ON companion_emotional_states(updated_at)
  `;

  // Index for lookups by companion + user
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emotional_states_companion_user
      ON companion_emotional_states(companion_id, user_id)
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS companion_emotional_states`;
}
