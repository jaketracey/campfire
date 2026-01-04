#!/usr/bin/env tsx
/**
 * Seed FAL.ai models into the database via admin API
 *
 * Usage:
 *   FAL_PROVIDER_ID="41be55f7-ec6a-4b5e-aa2d-463d30a75a2d" \
 *   GATEWAY_URL="https://api.campfire.com" \
 *   ADMIN_TOKEN="<admin-jwt>" \
 *   pnpm exec tsx scripts/seed-fal-models.ts
 */

interface FalModel {
  modelId: string;
  displayName: string;
  tier: 'FAST' | 'STANDARD' | 'QUALITY';
  costPerImage: number;
  avgGenerationTime: number;
  maxResolution: [number, number];
  supportsIpAdapter: boolean;
  supportsInpainting: boolean;
  supportsImg2img: boolean;
  falEndpoint: string;
  tags: string[];
}

// All 18 FAL.ai models from image_model_registry.py
const FAL_MODELS: FalModel[] = [
  {
    modelId: 'fal/dreamina-v3.1',
    displayName: 'Bytedance Dreamina 3.1',
    tier: 'QUALITY',
    costPerImage: 0.02,
    avgGenerationTime: 8.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: false,
    falEndpoint: 'fal-ai/bytedance/dreamina/v3.1/text-to-image',
    tags: ['photorealistic', 'portrait', 'cloud'],
  },
  {
    modelId: 'fal/flux-1.1-pro',
    displayName: 'Flux 1.1 Pro',
    tier: 'QUALITY',
    costPerImage: 0.04,
    avgGenerationTime: 10.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: true,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-pro/v1.1',
    tags: ['quality', 'versatile', 'cloud'],
  },
  {
    modelId: 'fal/flux-schnell',
    displayName: 'Flux Schnell (Fast)',
    tier: 'FAST',
    costPerImage: 0.003,
    avgGenerationTime: 2.0,
    maxResolution: [1024, 1024],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: false,
    falEndpoint: 'fal-ai/flux/schnell',
    tags: ['fast', 'cheap', 'cloud'],
  },
  {
    modelId: 'fal/flux-dev',
    displayName: 'Flux Dev',
    tier: 'STANDARD',
    costPerImage: 0.025,
    avgGenerationTime: 5.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: false,
    falEndpoint: 'fal-ai/flux/dev',
    tags: ['balanced', 'cloud'],
  },
  {
    modelId: 'fal/flux-2-max',
    displayName: 'Flux 2 Max (Premium)',
    tier: 'QUALITY',
    costPerImage: 0.08,
    avgGenerationTime: 12.0,
    maxResolution: [1536, 2048],
    supportsIpAdapter: true,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-2-max',
    tags: ['premium', 'quality', 'cloud', 'flux2'],
  },
  {
    modelId: 'fal/flux-2-turbo',
    displayName: 'Flux 2 Turbo (Fast)',
    tier: 'FAST',
    costPerImage: 0.01,
    avgGenerationTime: 2.5,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-2/turbo',
    tags: ['fast', 'turbo', 'cloud', 'flux2'],
  },
  {
    modelId: 'fal/flux-2-flash',
    displayName: 'Flux 2 Flash (Ultra-Fast)',
    tier: 'FAST',
    costPerImage: 0.006,
    avgGenerationTime: 1.5,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-2/flash',
    tags: ['ultrafast', 'flash', 'cloud', 'flux2'],
  },
  {
    modelId: 'fal/flux-2-flex',
    displayName: 'Flux 2 Flex (Configurable)',
    tier: 'STANDARD',
    costPerImage: 0.02,
    avgGenerationTime: 4.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-2-flex',
    tags: ['flexible', 'configurable', 'cloud', 'flux2'],
  },
  {
    modelId: 'fal/flux-kontext-pro',
    displayName: 'Flux Kontext Pro (Edit)',
    tier: 'QUALITY',
    costPerImage: 0.05,
    avgGenerationTime: 8.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: true,
    supportsInpainting: true,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-pro/kontext',
    tags: ['editing', 'consistency', 'cloud', 'kontext'],
  },
  {
    modelId: 'fal/flux-kontext-max',
    displayName: 'Flux Kontext Max (Premium Edit)',
    tier: 'QUALITY',
    costPerImage: 0.08,
    avgGenerationTime: 12.0,
    maxResolution: [1536, 2048],
    supportsIpAdapter: true,
    supportsInpainting: true,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-pro/kontext/max',
    tags: ['editing', 'premium', 'cloud', 'kontext'],
  },
  {
    modelId: 'fal/recraft-v3',
    displayName: 'Recraft V3',
    tier: 'QUALITY',
    costPerImage: 0.04,
    avgGenerationTime: 8.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: false,
    falEndpoint: 'fal-ai/recraft/v3/text-to-image',
    tags: ['typography', 'vector', 'brand', 'cloud'],
  },
  {
    modelId: 'fal/seedream-4.5',
    displayName: 'Seedream 4.5 (Bytedance)',
    tier: 'QUALITY',
    costPerImage: 0.025,
    avgGenerationTime: 6.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    tags: ['photorealistic', 'portrait', 'cloud'],
  },
  {
    modelId: 'fal/z-image-turbo',
    displayName: 'Z-Image Turbo (Super Fast)',
    tier: 'FAST',
    costPerImage: 0.004,
    avgGenerationTime: 1.5,
    maxResolution: [1024, 1024],
    supportsIpAdapter: false,
    supportsInpainting: true,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/z-image/turbo',
    tags: ['ultrafast', 'cheap', 'cloud'],
  },
  {
    modelId: 'fal/qwen-image-2512',
    displayName: 'Qwen Image 2512',
    tier: 'QUALITY',
    costPerImage: 0.03,
    avgGenerationTime: 8.0,
    maxResolution: [2512, 2512],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: false,
    falEndpoint: 'fal-ai/qwen-image-2512',
    tags: ['high-res', 'typography', 'cloud'],
  },
  {
    modelId: 'fal/longcat-image',
    displayName: 'LongCat Image',
    tier: 'STANDARD',
    costPerImage: 0.015,
    avgGenerationTime: 4.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: false,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/longcat-image',
    tags: ['multilingual', 'photorealism', 'cloud'],
  },
  {
    modelId: 'fal/flux-lora',
    displayName: 'Flux Dev LoRA',
    tier: 'STANDARD',
    costPerImage: 0.03,
    avgGenerationTime: 6.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: true,
    supportsInpainting: false,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-lora',
    tags: ['customizable', 'lora', 'cloud'],
  },
  {
    modelId: 'fal/flux-kontext-lora',
    displayName: 'Flux Kontext LoRA',
    tier: 'STANDARD',
    costPerImage: 0.025,
    avgGenerationTime: 5.0,
    maxResolution: [1024, 1536],
    supportsIpAdapter: true,
    supportsInpainting: true,
    supportsImg2img: true,
    falEndpoint: 'fal-ai/flux-kontext-lora',
    tags: ['customizable', 'lora', 'editing', 'cloud'],
  },
];

async function seedFalModels() {
  const providerId = process.env.FAL_PROVIDER_ID;
  const gatewayUrl = process.env.GATEWAY_URL;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!providerId) {
    console.error('Error: FAL_PROVIDER_ID environment variable is required');
    process.exit(1);
  }
  if (!gatewayUrl) {
    console.error('Error: GATEWAY_URL environment variable is required');
    process.exit(1);
  }
  if (!adminToken) {
    console.error('Error: ADMIN_TOKEN environment variable is required');
    process.exit(1);
  }

  console.log(`\nSeeding ${FAL_MODELS.length} FAL.ai models...`);
  console.log(`Provider ID: ${providerId}`);
  console.log(`Gateway URL: ${gatewayUrl}\n`);

  const results = {
    created: [] as string[],
    skipped: [] as string[],
    failed: [] as { modelId: string; error: string }[],
  };

  for (const model of FAL_MODELS) {
    try {
      const response = await fetch(
        `${gatewayUrl}/admin/image-providers/${providerId}/models`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            modelId: model.modelId,
            displayName: model.displayName,
            isEnabled: true,
            // Store image-specific metadata in the capabilities/metadata fields
            metadata: {
              tier: model.tier,
              costPerImage: model.costPerImage,
              avgGenerationTime: model.avgGenerationTime,
              maxResolution: model.maxResolution,
              supportsIpAdapter: model.supportsIpAdapter,
              supportsInpainting: model.supportsInpainting,
              supportsImg2img: model.supportsImg2img,
              falEndpoint: model.falEndpoint,
              tags: model.tags,
            },
          }),
        }
      );

      if (response.ok) {
        results.created.push(model.modelId);
        console.log(`✓ Created: ${model.displayName}`);
      } else if (response.status === 409) {
        results.skipped.push(model.modelId);
        console.log(`○ Skipped (already exists): ${model.displayName}`);
      } else {
        const errorText = await response.text();
        results.failed.push({ modelId: model.modelId, error: errorText });
        console.error(`✗ Failed: ${model.displayName} - ${response.status}: ${errorText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.failed.push({ modelId: model.modelId, error: errorMessage });
      console.error(`✗ Failed: ${model.displayName} - ${errorMessage}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Created: ${results.created.length}`);
  console.log(`Skipped: ${results.skipped.length}`);
  console.log(`Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed models:');
    for (const { modelId, error } of results.failed) {
      console.log(`  - ${modelId}: ${error}`);
    }
    process.exit(1);
  }

  console.log('\nDone!');
}

seedFalModels().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
