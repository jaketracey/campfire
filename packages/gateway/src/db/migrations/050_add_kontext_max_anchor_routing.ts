/**
 * Migration: Add Flux Kontext Max for identity-preserving anchor generation
 * Created: 2026-04-02
 *
 * Adds fal/flux-kontext-max as a model config and routing rule for image_anchor.
 * Kontext Max is a premium identity-preserving model that takes a reference image
 * and generates new scenes while maintaining the subject's face/identity.
 *
 * Current state: image_anchor only has fal/seedream-4.5 (text-to-image, no reference).
 * After: seedream-4.5 stays tier 1 (for primary/seed anchor with no reference),
 *        kontext-max added as tier 2 (for variation anchors with reference image).
 *
 * The router logic has been updated to allow requires_reference_image models when
 * the request actually has a reference image (requires_ip_adapter=true).
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Get the FAL image provider config ID
  const [falProvider] = await sql`
    SELECT id FROM provider_configs
    WHERE provider = 'fal' AND category = 'image' AND is_enabled = TRUE
    LIMIT 1
  `;

  if (!falProvider) {
    console.warn('No FAL image provider found - skipping Kontext Max routing setup');
    return;
  }

  // Upsert Kontext Max model config
  await sql`
    INSERT INTO model_configs (
      provider_config_id, model_id, display_name, is_enabled, metadata
    ) VALUES (
      ${falProvider.id},
      'fal/flux-kontext-max',
      'Flux Kontext Max (Premium Identity-Preserving)',
      TRUE,
      ${JSON.stringify({
        description: 'Premium identity-preserving image generation via Flux Kontext Max',
        tier: 'quality',
        supports_ip_adapter: true,
        requires_reference_image: true,
        avg_generation_time_ms: 12000,
        cost_per_image_usd: 0.08,
        fal_endpoint: 'fal-ai/flux-pro/kontext/max',
        tags: ['identity-aware', 'face-consistency', 'premium', 'kontext'],
      })}::jsonb
    )
    ON CONFLICT (model_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      is_enabled = EXCLUDED.is_enabled,
      metadata = EXCLUDED.metadata
  `;

  // Get the model config ID for the routing rule
  const [kontextMaxModel] = await sql`
    SELECT id FROM model_configs WHERE model_id = 'fal/flux-kontext-max' LIMIT 1
  `;

  if (!kontextMaxModel) {
    console.warn('Failed to find Kontext Max model config after insert');
    return;
  }

  // Add Kontext Max as tier 2 for image_anchor (used when reference image is available)
  await sql`
    INSERT INTO routing_rules (
      use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata
    ) VALUES (
      'image_anchor', 2, ${kontextMaxModel.id}, 100, TRUE, 2, 180000,
      '{"description": "Kontext Max for identity-preserving anchor variations (requires reference image)"}'::jsonb
    )
    ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
      weight = EXCLUDED.weight,
      is_enabled = EXCLUDED.is_enabled,
      metadata = EXCLUDED.metadata
  `;

  // Also add as tier 2 for image_variation (better quality than PuLID for character consistency)
  await sql`
    INSERT INTO routing_rules (
      use_case, tier, model_config_id, weight, is_enabled, max_retries, timeout_ms, metadata
    ) VALUES (
      'image_variation', 2, ${kontextMaxModel.id}, 100, TRUE, 2, 180000,
      '{"description": "Kontext Max for premium identity-preserving variations"}'::jsonb
    )
    ON CONFLICT (use_case, tier, model_config_id) DO UPDATE SET
      weight = EXCLUDED.weight,
      is_enabled = EXCLUDED.is_enabled,
      metadata = EXCLUDED.metadata
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Remove routing rules for Kontext Max
  const [kontextMaxModel] = await sql`
    SELECT id FROM model_configs WHERE model_id = 'fal/flux-kontext-max' LIMIT 1
  `;

  if (kontextMaxModel) {
    await sql`
      DELETE FROM routing_rules WHERE model_config_id = ${kontextMaxModel.id}
    `;
  }

  await sql`
    DELETE FROM model_configs WHERE model_id = 'fal/flux-kontext-max'
  `;
}
