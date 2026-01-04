-- Seed FAL.ai models into model_configs table
-- Run on production: docker exec -i campfire-postgres psql -U campfire campfire < seed-fal-models.sql

-- FAL.ai provider ID (from /admin/image-providers)
DO $$
DECLARE
  fal_provider_id UUID := '41be55f7-ec6a-4b5e-aa2d-463d30a75a2d';
BEGIN
  -- Insert models (skip if already exists)
  INSERT INTO model_configs (provider_config_id, model_id, display_name, is_enabled, metadata)
  VALUES
    (fal_provider_id, 'fal/dreamina-v3.1', 'Bytedance Dreamina 3.1', true,
     '{"tier": "QUALITY", "costPerImage": 0.02, "avgGenerationTime": 8.0, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": false, "falEndpoint": "fal-ai/bytedance/dreamina/v3.1/text-to-image", "tags": ["photorealistic", "portrait", "cloud"]}'),

    (fal_provider_id, 'fal/flux-1.1-pro', 'Flux 1.1 Pro', true,
     '{"tier": "QUALITY", "costPerImage": 0.04, "avgGenerationTime": 10.0, "maxResolution": [1024, 1536], "supportsIpAdapter": true, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-pro/v1.1", "tags": ["quality", "versatile", "cloud"]}'),

    (fal_provider_id, 'fal/flux-schnell', 'Flux Schnell (Fast)', true,
     '{"tier": "FAST", "costPerImage": 0.003, "avgGenerationTime": 2.0, "maxResolution": [1024, 1024], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": false, "falEndpoint": "fal-ai/flux/schnell", "tags": ["fast", "cheap", "cloud"]}'),

    (fal_provider_id, 'fal/flux-dev', 'Flux Dev', true,
     '{"tier": "STANDARD", "costPerImage": 0.025, "avgGenerationTime": 5.0, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": false, "falEndpoint": "fal-ai/flux/dev", "tags": ["balanced", "cloud"]}'),

    (fal_provider_id, 'fal/flux-2-max', 'Flux 2 Max (Premium)', true,
     '{"tier": "QUALITY", "costPerImage": 0.08, "avgGenerationTime": 12.0, "maxResolution": [1536, 2048], "supportsIpAdapter": true, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-2-max", "tags": ["premium", "quality", "cloud", "flux2"]}'),

    (fal_provider_id, 'fal/flux-2-turbo', 'Flux 2 Turbo (Fast)', true,
     '{"tier": "FAST", "costPerImage": 0.01, "avgGenerationTime": 2.5, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-2/turbo", "tags": ["fast", "turbo", "cloud", "flux2"]}'),

    (fal_provider_id, 'fal/flux-2-flash', 'Flux 2 Flash (Ultra-Fast)', true,
     '{"tier": "FAST", "costPerImage": 0.006, "avgGenerationTime": 1.5, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-2/flash", "tags": ["ultrafast", "flash", "cloud", "flux2"]}'),

    (fal_provider_id, 'fal/flux-2-flex', 'Flux 2 Flex (Configurable)', true,
     '{"tier": "STANDARD", "costPerImage": 0.02, "avgGenerationTime": 4.0, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-2-flex", "tags": ["flexible", "configurable", "cloud", "flux2"]}'),

    (fal_provider_id, 'fal/flux-kontext-pro', 'Flux Kontext Pro (Edit)', true,
     '{"tier": "QUALITY", "costPerImage": 0.05, "avgGenerationTime": 8.0, "maxResolution": [1024, 1536], "supportsIpAdapter": true, "supportsInpainting": true, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-pro/kontext", "tags": ["editing", "consistency", "cloud", "kontext"]}'),

    (fal_provider_id, 'fal/flux-kontext-max', 'Flux Kontext Max (Premium Edit)', true,
     '{"tier": "QUALITY", "costPerImage": 0.08, "avgGenerationTime": 12.0, "maxResolution": [1536, 2048], "supportsIpAdapter": true, "supportsInpainting": true, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-pro/kontext/max", "tags": ["editing", "premium", "cloud", "kontext"]}'),

    (fal_provider_id, 'fal/recraft-v3', 'Recraft V3', true,
     '{"tier": "QUALITY", "costPerImage": 0.04, "avgGenerationTime": 8.0, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": false, "falEndpoint": "fal-ai/recraft/v3/text-to-image", "tags": ["typography", "vector", "brand", "cloud"]}'),

    (fal_provider_id, 'fal/seedream-4.5', 'Seedream 4.5 (Bytedance)', true,
     '{"tier": "QUALITY", "costPerImage": 0.025, "avgGenerationTime": 6.0, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/bytedance/seedream/v4.5/text-to-image", "tags": ["photorealistic", "portrait", "cloud"]}'),

    (fal_provider_id, 'fal/z-image-turbo', 'Z-Image Turbo (Super Fast)', true,
     '{"tier": "FAST", "costPerImage": 0.004, "avgGenerationTime": 1.5, "maxResolution": [1024, 1024], "supportsIpAdapter": false, "supportsInpainting": true, "supportsImg2img": true, "falEndpoint": "fal-ai/z-image/turbo", "tags": ["ultrafast", "cheap", "cloud"]}'),

    (fal_provider_id, 'fal/qwen-image-2512', 'Qwen Image 2512', true,
     '{"tier": "QUALITY", "costPerImage": 0.03, "avgGenerationTime": 8.0, "maxResolution": [2512, 2512], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": false, "falEndpoint": "fal-ai/qwen-image-2512", "tags": ["high-res", "typography", "cloud"]}'),

    (fal_provider_id, 'fal/longcat-image', 'LongCat Image', true,
     '{"tier": "STANDARD", "costPerImage": 0.015, "avgGenerationTime": 4.0, "maxResolution": [1024, 1536], "supportsIpAdapter": false, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/longcat-image", "tags": ["multilingual", "photorealism", "cloud"]}'),

    (fal_provider_id, 'fal/flux-lora', 'Flux Dev LoRA', true,
     '{"tier": "STANDARD", "costPerImage": 0.03, "avgGenerationTime": 6.0, "maxResolution": [1024, 1536], "supportsIpAdapter": true, "supportsInpainting": false, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-lora", "tags": ["customizable", "lora", "cloud"]}'),

    (fal_provider_id, 'fal/flux-kontext-lora', 'Flux Kontext LoRA', true,
     '{"tier": "STANDARD", "costPerImage": 0.025, "avgGenerationTime": 5.0, "maxResolution": [1024, 1536], "supportsIpAdapter": true, "supportsInpainting": true, "supportsImg2img": true, "falEndpoint": "fal-ai/flux-kontext-lora", "tags": ["customizable", "lora", "editing", "cloud"]}')
  ON CONFLICT (provider_config_id, model_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

  RAISE NOTICE 'Seeded 17 FAL.ai models';
END $$;

-- Verify the insert
SELECT model_id, display_name, is_enabled, metadata->>'tier' as tier
FROM model_configs
WHERE provider_config_id = '41be55f7-ec6a-4b5e-aa2d-463d30a75a2d'
ORDER BY model_id;
