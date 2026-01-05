/**
 * Migration: Seed Video Model Routing
 * Created: 2026-01-05
 *
 * Seeds the video provider, models, and routing rules.
 * Requires migration 048 to have added the video use case enum values first.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Step 1: Seed FAL.ai video provider
  // =========================================================================
  await sql`
    INSERT INTO provider_configs (
      provider, display_name, is_enabled, priority, category, metadata
    ) VALUES
      ('fal_video', 'FAL.ai Video', TRUE, 1, 'video',
       '{"description": "Cloud video generation via FAL.ai", "requires_api_key": true, "api_key_env": "FAL_API_KEY"}'::jsonb)
    ON CONFLICT (provider) DO UPDATE SET
      category = EXCLUDED.category,
      metadata = EXCLUDED.metadata,
      display_name = EXCLUDED.display_name
  `;

  // =========================================================================
  // Step 2: Seed video models
  // =========================================================================
  const providers = await sql<{ id: string; provider: string }[]>`
    SELECT id, provider FROM provider_configs WHERE category = 'video'
  `;

  const providerMap = new Map<string, string>(providers.map(p => [p.provider, p.id]));

  // Seed FAL.ai video models
  const falVideoId = providerMap.get('fal_video');
  if (falVideoId) {
    await sql`
      INSERT INTO model_configs (
        provider_config_id, model_id, display_name, is_enabled,
        context_window, max_output_tokens,
        input_cost_per_million, output_cost_per_million,
        capabilities, metadata
      ) VALUES
        (${falVideoId}, 'fal/kling-video/v1.6/pro/text-to-video', 'Kling 1.6 Pro (Text)', TRUE,
         NULL, NULL, 0.065, NULL,
         '["video_generation"]'::jsonb,
         '{"description": "Kling 1.6 Pro text-to-video generation", "max_duration_seconds": 10, "supports_image_to_video": false, "supports_lip_sync": false, "tier": "QUALITY", "cost_per_second_cents": 6.5}'::jsonb),
        (${falVideoId}, 'fal/kling-video/v1.6/pro/image-to-video', 'Kling 1.6 Pro (Image)', TRUE,
         NULL, NULL, 0.065, NULL,
         '["video_generation", "image_to_video"]'::jsonb,
         '{"description": "Kling 1.6 Pro image-to-video generation", "max_duration_seconds": 10, "supports_image_to_video": true, "supports_lip_sync": false, "tier": "QUALITY", "cost_per_second_cents": 6.5}'::jsonb),
        (${falVideoId}, 'fal/minimax/video-01', 'Minimax Video-01', TRUE,
         NULL, NULL, 0.04, NULL,
         '["video_generation", "image_to_video"]'::jsonb,
         '{"description": "Minimax Video-01 generation", "max_duration_seconds": 6, "supports_image_to_video": true, "supports_lip_sync": false, "tier": "STANDARD", "cost_per_second_cents": 4.0}'::jsonb),
        (${falVideoId}, 'fal/minimax/video-01-live', 'Minimax Video-01 Live', TRUE,
         NULL, NULL, 0.05, NULL,
         '["video_generation", "image_to_video"]'::jsonb,
         '{"description": "Minimax Video-01 Live for faster generation", "max_duration_seconds": 6, "supports_image_to_video": true, "supports_lip_sync": false, "tier": "FAST", "cost_per_second_cents": 5.0}'::jsonb),
        (${falVideoId}, 'fal/luma-dream-machine', 'Luma Dream Machine', TRUE,
         NULL, NULL, 0.032, NULL,
         '["video_generation", "image_to_video"]'::jsonb,
         '{"description": "Luma Dream Machine video generation", "max_duration_seconds": 5, "supports_image_to_video": true, "supports_lip_sync": false, "tier": "STANDARD", "cost_per_second_cents": 3.2}'::jsonb),
        (${falVideoId}, 'fal/kling-video/v1.6/pro/lip-sync', 'Kling 1.6 Pro Lip Sync', TRUE,
         NULL, NULL, 0.08, NULL,
         '["video_generation", "lip_sync"]'::jsonb,
         '{"description": "Kling 1.6 Pro with lip sync support", "max_duration_seconds": 10, "supports_image_to_video": true, "supports_lip_sync": true, "tier": "QUALITY", "cost_per_second_cents": 8.0}'::jsonb)
      ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
        metadata = EXCLUDED.metadata,
        capabilities = EXCLUDED.capabilities,
        display_name = EXCLUDED.display_name
    `;
  }

  // =========================================================================
  // Step 3: Seed default video routing rules
  // =========================================================================
  const models = await sql<{ id: string; model_id: string }[]>`
    SELECT mc.id, mc.model_id
    FROM model_configs mc
    JOIN provider_configs pc ON pc.id = mc.provider_config_id
    WHERE pc.category = 'video' AND mc.is_enabled = TRUE
  `;

  const modelMap = new Map<string, string>(models.map(m => [m.model_id, m.id]));

  const getModelId = (modelId: string): string | undefined => modelMap.get(modelId);

  // -------------------------------------------------------------------------
  // video_generation: Text-to-video generation
  // Tier 1: Kling 1.6 Pro (Text) - highest quality
  // Tier 2: Minimax Video-01 - good quality, faster
  // -------------------------------------------------------------------------
  const klingTextId = getModelId('fal/kling-video/v1.6/pro/text-to-video');
  const minimaxId = getModelId('fal/minimax/video-01');

  if (klingTextId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_generation', 1, ${klingTextId}, 100, TRUE, 2, 300000,
        '{"description": "Kling 1.6 Pro for highest quality text-to-video"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (minimaxId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_generation', 2, ${minimaxId}, 100, TRUE, 3, 300000,
        '{"description": "Minimax Video-01 fallback for text-to-video"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // -------------------------------------------------------------------------
  // video_from_image: Image-to-video generation
  // Tier 1: Kling 1.6 Pro (Image) - highest quality
  // Tier 2: Luma Dream Machine - fast and good quality
  // -------------------------------------------------------------------------
  const klingImageId = getModelId('fal/kling-video/v1.6/pro/image-to-video');
  const lumaId = getModelId('fal/luma-dream-machine');

  if (klingImageId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_from_image', 1, ${klingImageId}, 100, TRUE, 2, 300000,
        '{"description": "Kling 1.6 Pro for highest quality image-to-video"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (lumaId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_from_image', 2, ${lumaId}, 100, TRUE, 3, 300000,
        '{"description": "Luma Dream Machine fallback for image-to-video"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // -------------------------------------------------------------------------
  // video_lip_sync: Lip sync video generation
  // Tier 1: Kling 1.6 Pro Lip Sync - only model with lip sync support
  // -------------------------------------------------------------------------
  const klingLipSyncId = getModelId('fal/kling-video/v1.6/pro/lip-sync');

  if (klingLipSyncId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_lip_sync', 1, ${klingLipSyncId}, 100, TRUE, 2, 300000,
        '{"description": "Kling 1.6 Pro Lip Sync for audio-synchronized video"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  // -------------------------------------------------------------------------
  // video_motion_brush: Motion brush/painting mode
  // Tier 1: Kling 1.6 Pro (Image) - supports motion control
  // Tier 2: Minimax Video-01 - fallback
  // -------------------------------------------------------------------------
  if (klingImageId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_motion_brush', 1, ${klingImageId}, 100, TRUE, 2, 300000,
        '{"description": "Kling 1.6 Pro for motion brush video generation"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }

  if (minimaxId) {
    await sql`
      INSERT INTO routing_rules (use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata)
      VALUES ('video_motion_brush', 2, ${minimaxId}, 100, TRUE, 3, 300000,
        '{"description": "Minimax Video-01 fallback for motion brush"}'::jsonb)
      ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
        weight = EXCLUDED.weight,
        is_enabled = EXCLUDED.is_enabled,
        metadata = EXCLUDED.metadata
    `;
  }
}

export async function down(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Remove routing rules for video use cases
  // =========================================================================
  await sql`
    DELETE FROM routing_rules
    WHERE use_case IN ('video_generation', 'video_from_image', 'video_lip_sync', 'video_motion_brush')
  `;

  // =========================================================================
  // Remove video models
  // =========================================================================
  const videoModels = [
    'fal/kling-video/v1.6/pro/text-to-video',
    'fal/kling-video/v1.6/pro/image-to-video',
    'fal/minimax/video-01',
    'fal/minimax/video-01-live',
    'fal/luma-dream-machine',
    'fal/kling-video/v1.6/pro/lip-sync',
  ];

  await sql`
    DELETE FROM model_configs WHERE model_id = ANY(${videoModels})
  `;

  // =========================================================================
  // Remove video providers
  // =========================================================================
  await sql`
    DELETE FROM provider_configs WHERE provider = 'fal_video'
  `;
}
