/**
 * Migration: Add Image Model Routing
 * Created: 2026-01-04
 *
 * Extends the provider routing system to support image generation:
 * 1. Adds category column to provider_configs for separating text/image providers
 * 2. Seeds image providers: ComfyUI (local) and FAL.ai (cloud)
 * 3. Seeds image models with capabilities metadata
 * 4. Creates default routing rules for image use cases
 *
 * Note: This migration depends on 040_add_image_use_case_enum.ts which adds
 * the enum values. PostgreSQL requires enum values to be committed before use.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Step 1: Add category column to provider_configs
  // =========================================================================
  await sql`
    ALTER TABLE provider_configs
    ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'text'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_provider_configs_category
    ON provider_configs (category, is_enabled)
  `;

  await sql`
    COMMENT ON COLUMN provider_configs.category IS 'Provider category: text or image'
  `;

  // =========================================================================
  // Step 3: Update existing providers to have category='text'
  // (Already handled by DEFAULT, but explicit for clarity)
  // =========================================================================
  await sql`
    UPDATE provider_configs SET category = 'text' WHERE category IS NULL
  `;

  // =========================================================================
  // Step 4: Seed image providers
  // =========================================================================
  await sql`
    INSERT INTO provider_configs (
      provider, display_name, is_enabled, priority, category, metadata
    ) VALUES
      ('comfyui', 'ComfyUI (Local)', TRUE, 1, 'image',
       '{"description": "Local Stable Diffusion via ComfyUI", "requires_api_key": false}'::jsonb),
      ('fal', 'FAL.ai', TRUE, 2, 'image',
       '{"description": "Cloud image generation via FAL.ai", "requires_api_key": true, "api_key_env": "FAL_API_KEY"}'::jsonb)
    ON CONFLICT (provider) DO UPDATE SET
      category = EXCLUDED.category,
      metadata = EXCLUDED.metadata
  `;

  // =========================================================================
  // Step 5: Seed image models
  // =========================================================================
  const providers = await sql<{ id: string; provider: string }[]>`
    SELECT id, provider FROM provider_configs WHERE category = 'image'
  `;

  const providerMap = new Map<string, string>(providers.map(p => [p.provider, p.id]));

  // Seed ComfyUI models
  const comfyuiId = providerMap.get('comfyui');
  if (comfyuiId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${comfyuiId}, 'comfyui/epicrealism', 'EpicRealism XL', TRUE,
         NULL, NULL, 0, 0,
         '["image_generation", "ip_adapter"]'::jsonb,
         '{"nsfw_capable": true, "supports_ip_adapter": true, "tier": "STANDARD", "description": "High quality photorealistic model"}'::jsonb),
        (${comfyuiId}, 'comfyui/sdxl-base', 'SDXL Base', TRUE,
         NULL, NULL, 0, 0,
         '["image_generation", "ip_adapter"]'::jsonb,
         '{"nsfw_capable": true, "supports_ip_adapter": true, "tier": "STANDARD", "description": "Stable Diffusion XL base model"}'::jsonb),
        (${comfyuiId}, 'comfyui/sdxl-turbo', 'SDXL Turbo', TRUE,
         NULL, NULL, 0, 0,
         '["image_generation"]'::jsonb,
         '{"nsfw_capable": true, "supports_ip_adapter": false, "tier": "FAST", "description": "Fast SDXL variant, fewer steps needed"}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata,
        capabilities = EXCLUDED.capabilities
    `;
  }

  // Seed FAL.ai models
  const falId = providerMap.get('fal');
  if (falId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${falId}, 'fal/dreamina-v3.1', 'Bytedance Dreamina 3.1', TRUE,
         NULL, NULL, 0.04, NULL,
         '["image_generation"]'::jsonb,
         '{"nsfw_capable": false, "supports_ip_adapter": false, "tier": "STANDARD", "description": "Bytedance Dreamina high quality model"}'::jsonb),
        (${falId}, 'fal/flux-1.1-pro', 'Flux 1.1 Pro', TRUE,
         NULL, NULL, 0.05, NULL,
         '["image_generation", "ip_adapter"]'::jsonb,
         '{"nsfw_capable": false, "supports_ip_adapter": true, "tier": "STANDARD", "description": "Flux Pro with IP-Adapter support"}'::jsonb),
        (${falId}, 'fal/flux-schnell', 'Flux Schnell', TRUE,
         NULL, NULL, 0.003, NULL,
         '["image_generation"]'::jsonb,
         '{"nsfw_capable": false, "supports_ip_adapter": false, "tier": "FAST", "description": "Fast Flux variant for quick generation"}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata,
        capabilities = EXCLUDED.capabilities
    `;
  }

  // =========================================================================
  // Step 6: Seed default image routing rules
  // =========================================================================
  const models = await sql<{ id: string; model_id: string }[]>`
    SELECT mc.id, mc.model_id
    FROM model_configs mc
    JOIN provider_configs pc ON pc.id = mc.provider_config_id
    WHERE pc.category = 'image' AND mc.is_enabled = TRUE
  `;

  const modelMap = new Map<string, string>(models.map(m => [m.model_id, m.id]));

  const getModelId = (modelId: string): string | undefined => modelMap.get(modelId);

  // -------------------------------------------------------------------------
  // image_generation: General image creation
  // Tier 1: comfyui/epicrealism (local, NSFW capable, high quality)
  // Tier 2: fal/dreamina-v3.1 (cloud fallback, SFW only)
  // -------------------------------------------------------------------------
  const epicrealismId = getModelId('comfyui/epicrealism');
  const dreaminaId = getModelId('fal/dreamina-v3.1');

  if (epicrealismId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('image_generation', 1, ${epicrealismId}, 100, TRUE, 2, 120000,
        '{"description": "Local EpicRealism for high quality photorealistic images", "nsfw_capable": true}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (dreaminaId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('image_generation', 2, ${dreaminaId}, 100, TRUE, 3, 180000,
        '{"description": "Cloud fallback via FAL.ai Dreamina", "nsfw_capable": false}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // -------------------------------------------------------------------------
  // image_anchor: Reference images for companion appearance
  // Tier 1: comfyui/epicrealism (local, supports IP-Adapter)
  // Tier 2: fal/flux-1.1-pro (cloud, supports IP-Adapter)
  // -------------------------------------------------------------------------
  const fluxProId = getModelId('fal/flux-1.1-pro');

  if (epicrealismId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('image_anchor', 1, ${epicrealismId}, 100, TRUE, 2, 120000,
        '{"description": "Local EpicRealism with IP-Adapter for anchor images", "supports_ip_adapter": true}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (fluxProId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('image_anchor', 2, ${fluxProId}, 100, TRUE, 3, 180000,
        '{"description": "Cloud Flux Pro with IP-Adapter support", "supports_ip_adapter": true}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // -------------------------------------------------------------------------
  // image_variation: Generate variations of existing images
  // Tier 1: comfyui/epicrealism (local, supports IP-Adapter for consistency)
  // Tier 2: fal/flux-1.1-pro (cloud, supports IP-Adapter)
  // -------------------------------------------------------------------------
  if (epicrealismId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('image_variation', 1, ${epicrealismId}, 100, TRUE, 2, 120000,
        '{"description": "Local EpicRealism with IP-Adapter for consistent variations", "supports_ip_adapter": true}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (fluxProId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('image_variation', 2, ${fluxProId}, 100, TRUE, 3, 180000,
        '{"description": "Cloud Flux Pro for image variations", "supports_ip_adapter": true}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Remove routing rules for image use cases
  // =========================================================================
  await sql`
    DELETE FROM routing_rules
    WHERE use_case IN ('image_generation', 'image_anchor', 'image_variation')
  `;

  // =========================================================================
  // Remove image models
  // =========================================================================
  const imageModels = [
    'comfyui/epicrealism',
    'comfyui/sdxl-base',
    'comfyui/sdxl-turbo',
    'fal/dreamina-v3.1',
    'fal/flux-1.1-pro',
    'fal/flux-schnell',
  ];

  await sql`
    DELETE FROM model_configs WHERE model_id = ANY(${imageModels})
  `;

  // =========================================================================
  // Remove image providers
  // =========================================================================
  await sql`
    DELETE FROM provider_configs WHERE provider IN ('comfyui', 'fal')
  `;

  // =========================================================================
  // Remove category column and index
  // =========================================================================
  await sql`
    DROP INDEX IF EXISTS idx_provider_configs_category
  `;

  await sql`
    ALTER TABLE provider_configs DROP COLUMN IF EXISTS category
  `;

  // =========================================================================
  // Note: Cannot remove enum values in PostgreSQL without recreating the type
  // The image_generation, image_anchor, image_variation values will remain
  // but be unused. This is safe and a common PostgreSQL limitation.
  // =========================================================================
}
