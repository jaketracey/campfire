/**
 * Migration: Seed Gift Routing Rules
 * Created: 2026-01-05
 *
 * Seeds default routing rules for gift generation use cases:
 * - gift_generation: Text generation for gift content (LLM)
 * - gift_image: Image generation for gift visuals
 *
 * These are configurable via /admin/routing after migration.
 *
 * Strategy:
 * - Text (gift_generation):
 *   - Tier 1: qwen2.5 (local, creative, good at JSON)
 *   - Tier 2: Claude 3.5 Haiku (fast cloud, excellent structured output)
 *
 * - Image (gift_image):
 *   - Tier 1: ComfyUI EpicRealism (local, high quality stylized)
 *   - Tier 2: FAL Dreamina/Seedream (cloud fallback)
 *
 * Note: This migration depends on 046_add_gift_use_cases.ts which adds
 * the enum values. PostgreSQL requires enum values to be committed before use.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Get all enabled models
  const models = await sql<{ id: string; model_id: string }[]>`
    SELECT id, model_id FROM model_configs WHERE is_enabled = TRUE
  `;

  const modelMap = new Map(models.map(m => [m.model_id, m.id]));
  const getModelId = (modelId: string): string | undefined => modelMap.get(modelId);

  // =========================================================================
  // gift_generation: LLM text generation for gift content
  // Tier 1: qwen2.5 (local, creative, good JSON output)
  // Tier 2: Claude 3.5 Haiku (fast cloud, excellent structured output)
  // =========================================================================
  const qwen25Id = getModelId('qwen2.5');
  const haikuId = getModelId('claude-3-5-haiku-20241022');

  if (qwen25Id) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('gift_generation', 1, ${qwen25Id}, 100, TRUE, 2, 30000,
        '{"description": "Local qwen2.5 for creative gift content generation", "default_temperature": 0.9}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (haikuId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('gift_generation', 2, ${haikuId}, 100, TRUE, 3, 60000,
        '{"description": "Claude Haiku cloud fallback for gift content", "default_temperature": 0.9}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // =========================================================================
  // gift_image: Image generation for gift visuals
  // Tier 1: ComfyUI EpicRealism (local, high quality stylized)
  // Tier 2: FAL Dreamina/Seedream (cloud fallback)
  // =========================================================================
  const epicrealismId = getModelId('comfyui/epicrealism');
  const dreaminaId = getModelId('fal/dreamina-v3.1');
  const seedreamId = getModelId('fal/seedream-v3.1-photorealistic');

  if (epicrealismId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('gift_image', 1, ${epicrealismId}, 100, TRUE, 2, 120000,
        '{"description": "Local EpicRealism for stylized gift images", "default_style": "stylized", "default_size": "512x512"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // Try Seedream first, then Dreamina as cloud fallback
  const cloudImageModelId = seedreamId || dreaminaId;
  if (cloudImageModelId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('gift_image', 2, ${cloudImageModelId}, 100, TRUE, 3, 180000,
        '{"description": "Cloud fallback for gift image generation", "default_style": "stylized", "default_size": "512x512"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove gift routing rules
  await sql`DELETE FROM routing_rules WHERE use_case IN ('gift_generation', 'gift_image')`;
}
