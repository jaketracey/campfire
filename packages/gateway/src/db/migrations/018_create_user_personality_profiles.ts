/**
 * Migration: Create User Personality Profiles Table
 * Created: 2026-01-01
 *
 * Stores AI-generated personality profiles based on user chat history analysis.
 * Used for personalized dashboard welcome messages and user insights.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Greeting style enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE greeting_style AS ENUM ('warm', 'playful', 'formal', 'friendly');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Preferred tone enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE preferred_tone AS ENUM ('casual', 'formal', 'playful', 'direct');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Verbosity enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE verbosity_level AS ENUM ('concise', 'moderate', 'detailed');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // User Personality Profiles Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS user_personality_profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Analysis metadata
      analysis_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      turns_analyzed INTEGER NOT NULL DEFAULT 0,
      last_analysis_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_analysis_threshold INTEGER NOT NULL DEFAULT 50,

      -- Personality traits (0-100 scale, matching companion personality system)
      warmth INTEGER CHECK (warmth >= 0 AND warmth <= 100),
      energy INTEGER CHECK (energy >= 0 AND energy <= 100),
      humor INTEGER CHECK (humor >= 0 AND humor <= 100),
      formality INTEGER CHECK (formality >= 0 AND formality <= 100),
      curiosity INTEGER CHECK (curiosity >= 0 AND curiosity <= 100),
      openness INTEGER CHECK (openness >= 0 AND openness <= 100),

      -- Communication style detected
      preferred_tone preferred_tone,
      verbosity verbosity_level,

      -- Insights and interests (JSONB arrays)
      personality_insights JSONB NOT NULL DEFAULT '[]',
      detected_interests JSONB NOT NULL DEFAULT '[]',
      conversation_themes JSONB NOT NULL DEFAULT '[]',

      -- Welcome message customization
      greeting_style greeting_style NOT NULL DEFAULT 'friendly',
      custom_insight TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT user_personality_profiles_user_unique UNIQUE (user_id)
    )
  `;

  // Indexes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_personality_profiles_user_id
    ON user_personality_profiles (user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_personality_profiles_last_analysis
    ON user_personality_profiles (last_analysis_at)
  `;

  // Index for finding users needing re-analysis
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_personality_profiles_threshold
    ON user_personality_profiles (next_analysis_threshold, turns_analyzed)
  `;

  // Updated at trigger
  await sql`
    CREATE TRIGGER user_personality_profiles_updated_at
    BEFORE UPDATE ON user_personality_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE user_personality_profiles IS 'AI-generated personality profiles from user chat analysis'
  `;
  await sql`
    COMMENT ON COLUMN user_personality_profiles.custom_insight IS 'Personalized insight message like "Your curious spirit shines through"'
  `;
  await sql`
    COMMENT ON COLUMN user_personality_profiles.next_analysis_threshold IS 'Total turn count that triggers next re-analysis'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS user_personality_profiles_updated_at ON user_personality_profiles`;
  await sql`DROP TABLE IF EXISTS user_personality_profiles CASCADE`;
  await sql`DROP TYPE IF EXISTS verbosity_level`;
  await sql`DROP TYPE IF EXISTS preferred_tone`;
  await sql`DROP TYPE IF EXISTS greeting_style`;
}
