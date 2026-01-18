/**
 * Migration: Create Influencer Models Table
 * Created: 2026-01-18
 *
 * Implements custom LoRA model training for influencer personas.
 * Uses FAL.ai flux-lora-fast-training API for fine-tuning.
 *
 * Features:
 * - Status tracking through training pipeline
 * - S3 storage for training images and resulting weights
 * - FAL.ai job tracking for async training
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Create status enum for training pipeline
  // =========================================================================
  await sql`
    CREATE TYPE influencer_model_status AS ENUM (
      'pending',      -- Model created, waiting for images
      'uploading',    -- Images being uploaded
      'training',     -- FAL.ai training in progress
      'downloading',  -- Downloading LoRA weights from FAL
      'ready',        -- Training complete, LoRA ready to use
      'failed'        -- Training failed
    )
  `;

  // =========================================================================
  // Create influencer_models table
  // =========================================================================
  await sql`
    CREATE TABLE influencer_models (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Model identification
      name VARCHAR(255) NOT NULL,
      trigger_word VARCHAR(100) NOT NULL,

      -- Training configuration
      training_steps INTEGER NOT NULL DEFAULT 1000,
      is_style BOOLEAN NOT NULL DEFAULT FALSE,

      -- Pipeline status
      status influencer_model_status NOT NULL DEFAULT 'pending',
      status_message TEXT,

      -- S3 storage keys
      training_images_s3_keys TEXT[] NOT NULL DEFAULT '{}',
      training_zip_s3_key TEXT,
      lora_s3_key TEXT,

      -- FAL.ai integration
      fal_training_job_id TEXT,
      fal_result_url TEXT,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      training_started_at TIMESTAMPTZ,
      training_completed_at TIMESTAMPTZ
    )
  `;

  // =========================================================================
  // Create indexes
  // =========================================================================

  // Index for listing models by status
  await sql`
    CREATE INDEX idx_influencer_models_status
    ON influencer_models (status, created_at DESC)
  `;

  // Index for finding models by name
  await sql`
    CREATE INDEX idx_influencer_models_name
    ON influencer_models (name)
  `;

  // Index for FAL job lookup
  await sql`
    CREATE INDEX idx_influencer_models_fal_job
    ON influencer_models (fal_training_job_id)
    WHERE fal_training_job_id IS NOT NULL
  `;

  // =========================================================================
  // Add column comments
  // =========================================================================
  await sql`
    COMMENT ON TABLE influencer_models IS 'Custom LoRA models trained on influencer images'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.trigger_word IS 'Unique token to invoke this LoRA in prompts (e.g., sarahj)'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.training_steps IS 'Number of training steps for FAL.ai (typically 1000)'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.is_style IS 'Whether this is a style LoRA vs person/subject LoRA'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.training_images_s3_keys IS 'Array of S3 keys for uploaded training images'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.training_zip_s3_key IS 'S3 key for the ZIP file sent to FAL.ai'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.lora_s3_key IS 'S3 key for the trained LoRA weights (.safetensors)'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.fal_training_job_id IS 'FAL.ai queue request ID for training job'
  `;

  await sql`
    COMMENT ON COLUMN influencer_models.fal_result_url IS 'FAL CDN URL for trained LoRA (before download to S3)'
  `;

  // =========================================================================
  // Create trigger for updated_at
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION update_influencer_models_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER influencer_models_updated_at_trigger
    BEFORE UPDATE ON influencer_models
    FOR EACH ROW
    EXECUTE FUNCTION update_influencer_models_updated_at()
  `;

  // =========================================================================
  // Create sample generation status enum
  // =========================================================================
  await sql`
    CREATE TYPE influencer_sample_status AS ENUM (
      'pending',      -- Generation queued
      'generating',   -- FAL.ai generation in progress
      'completed',    -- Generation successful
      'failed'        -- Generation failed
    )
  `;

  // =========================================================================
  // Create influencer_model_samples table
  // =========================================================================
  await sql`
    CREATE TABLE influencer_model_samples (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id UUID NOT NULL REFERENCES influencer_models(id) ON DELETE CASCADE,

      -- Generation parameters
      prompt TEXT NOT NULL,
      negative_prompt TEXT,
      guidance_scale REAL NOT NULL DEFAULT 7.5,
      lora_scale REAL NOT NULL DEFAULT 1.0,
      num_inference_steps INTEGER NOT NULL DEFAULT 28,
      seed INTEGER,
      width INTEGER NOT NULL DEFAULT 768,
      height INTEGER NOT NULL DEFAULT 1024,

      -- Status
      status influencer_sample_status NOT NULL DEFAULT 'pending',
      error_message TEXT,

      -- FAL.ai integration
      fal_request_id TEXT,

      -- Result
      image_s3_key TEXT,
      image_url TEXT,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `;

  // Index for listing samples by model
  await sql`
    CREATE INDEX idx_influencer_model_samples_model
    ON influencer_model_samples (model_id, created_at DESC)
  `;

  // Index for pending samples (for polling)
  await sql`
    CREATE INDEX idx_influencer_model_samples_pending
    ON influencer_model_samples (status, created_at)
    WHERE status IN ('pending', 'generating')
  `;

  await sql`
    COMMENT ON TABLE influencer_model_samples IS 'Generated sample images for testing trained LoRA models'
  `;

  await sql`
    COMMENT ON COLUMN influencer_model_samples.lora_scale IS 'Strength of LoRA effect (0.0-1.5, default 1.0)'
  `;

  await sql`
    COMMENT ON COLUMN influencer_model_samples.guidance_scale IS 'CFG scale for generation (typically 3.5-8.0)'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS influencer_model_samples`;
  await sql`DROP TYPE IF EXISTS influencer_sample_status`;
  await sql`DROP TRIGGER IF EXISTS influencer_models_updated_at_trigger ON influencer_models`;
  await sql`DROP FUNCTION IF EXISTS update_influencer_models_updated_at()`;
  await sql`DROP TABLE IF EXISTS influencer_models`;
  await sql`DROP TYPE IF EXISTS influencer_model_status`;
}
