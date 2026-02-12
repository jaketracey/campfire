/**
 * Migration: Add influencer model data integrity constraints
 * Created: 2026-02-12
 *
 * Enforces:
 * - trigger_word uniqueness
 * - trigger_word format at DB layer
 * - max training images count at DB layer
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Enforce trigger word format in DB (matches service validation)
  await sql`
    ALTER TABLE influencer_models
    ADD CONSTRAINT influencer_models_trigger_word_format
    CHECK (trigger_word ~ '^[a-z0-9_]+$')
  `;

  // Enforce maximum number of training images in DB
  await sql`
    ALTER TABLE influencer_models
    ADD CONSTRAINT influencer_models_training_images_max
    CHECK (cardinality(training_images_s3_keys) <= 25)
  `;

  // Ensure trigger word is globally unique
  await sql`
    CREATE UNIQUE INDEX idx_influencer_models_trigger_word_unique
    ON influencer_models (trigger_word)
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_influencer_models_trigger_word_unique`;
  await sql`ALTER TABLE influencer_models DROP CONSTRAINT IF EXISTS influencer_models_training_images_max`;
  await sql`ALTER TABLE influencer_models DROP CONSTRAINT IF EXISTS influencer_models_trigger_word_format`;
}
