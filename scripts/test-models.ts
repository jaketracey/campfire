/**
 * Test different FAL models for companion image generation
 *
 * Models to test:
 * - fal-ai/nano-banana-pro (Nano Banana Pro)
 * - fal-ai/bytedance/seedream/v4/text-to-image (Seedream v4)
 * - fal-ai/flux-2-pro (FLUX 2 Pro)
 * - fal-ai/flux-lora (FLUX with LoRA support)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAL_API_KEY = process.env.FAL_API_KEY || '';
const FAL_BASE_URL = 'https://queue.fal.run';

const OUTPUT_DIR = path.join(__dirname, '../packages/web/public/images/companions/model-tests');

// Models to test
const MODELS = {
  'nano-banana': 'fal-ai/nano-banana-pro',
  'seedream': 'fal-ai/bytedance/seedream/v4/text-to-image',
  'flux2-pro': 'fal-ai/flux-2-pro',
  'flux-lora': 'fal-ai/flux-lora',
  'dreamina': 'fal-ai/bytedance/dreamina/v3.1/text-to-image',
};

// Test prompts - varied styles
const TEST_PROMPTS = [
  {
    name: 'athletic-woman',
    prompt: `Three-quarter body portrait of a 28 year old athletic Latina woman with warm olive skin and brown hair. She has a toned, fit physique with visible muscle definition. Wearing a coral colored racerback tank top and compression leggings. Standing confidently in a modern gym with natural window lighting. Warm, genuine smile, looking at camera. Professional fitness photography, Sony A7R IV, 50mm f/1.8, 8K resolution, photorealistic.`,
  },
  {
    name: 'muscular-man',
    prompt: `Three-quarter body portrait of a 32 year old muscular Black man with rich dark skin. He has a well-built frame with developed muscles. Wearing a navy blue fitted compression tank and gym shorts. Standing in a modern fitness studio with soft natural lighting. Confident, approachable expression. Professional fitness photography, shallow depth of field, photorealistic, 8K.`,
  },
  {
    name: 'curvy-woman',
    prompt: `Three-quarter body portrait of a 35 year old curvy East Asian woman with delicate features. She has a voluptuous figure with feminine curves. Wearing a deep purple supportive sports bra and form-fitting yoga pants. Modern minimalist gym background with large windows. Warm smile, confident posture. Professional photography, natural skin texture, photorealistic.`,
  },
];

// LoRAs to try with flux-lora model
const LORAS = [
  {
    name: 'no-lora',
    loras: [],
  },
  // Add LoRA URLs here if you have specific ones to test
  // {
  //   name: 'realism-lora',
  //   loras: [{ path: 'https://...', scale: 0.8 }],
  // },
];

const NEGATIVE_PROMPT = [
  'ugly', 'deformed', 'disfigured', 'low quality', 'blurry', 'pixelated',
  'bad anatomy', 'extra limbs', 'bad hands', 'extra fingers',
  'watermark', 'text', 'signature', 'logo', 'cartoon', 'anime', '3d render',
  'plastic skin', 'wax figure', 'mannequin', 'artificial', 'nude', 'nsfw',
].join(', ');

interface FalQueueResponse {
  status_url: string;
  response_url: string;
  request_id: string;
}

async function submitToFal(model: string, params: Record<string, any>): Promise<FalQueueResponse> {
  const response = await fetch(`${FAL_BASE_URL}/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`FAL submit failed: ${response.status} - ${error}`);
  }

  return response.json();
}

async function pollForResult(statusUrl: string, responseUrl: string): Promise<any> {
  const maxWait = 180000;
  const pollInterval = 2000;
  let elapsed = 0;

  while (elapsed < maxWait) {
    const statusResponse = await fetch(statusUrl, {
      headers: { 'Authorization': `Key ${FAL_API_KEY}` },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      throw new Error(`Status check failed: ${statusResponse.status} - ${errorText}`);
    }

    const status = await statusResponse.json();
    process.stdout.write(`\r  Status: ${status.status}...`);

    if (status.status === 'COMPLETED') {
      const resultResponse = await fetch(responseUrl, {
        headers: { 'Authorization': `Key ${FAL_API_KEY}` },
      });
      console.log(' Done!');
      return resultResponse.json();
    }

    if (status.status === 'FAILED') {
      throw new Error(`Generation failed: ${JSON.stringify(status)}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  throw new Error(`Request timed out`);
}

async function downloadImage(url: string, filepath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filepath, Buffer.from(buffer));
}

function getModelParams(modelKey: string, prompt: string, loras?: any[]): Record<string, any> {
  const baseParams: Record<string, any> = {
    prompt,
    num_images: 1,
  };

  switch (modelKey) {
    case 'nano-banana':
      return {
        ...baseParams,
        resolution: '2K',
        aspect_ratio: '3:4',  // Portrait
        output_format: 'png',
      };

    case 'seedream':
      return {
        ...baseParams,
        negative_prompt: NEGATIVE_PROMPT,
        image_size: { width: 768, height: 1024 },
        enable_safety_checker: false,
      };

    case 'flux2-pro':
      return {
        ...baseParams,
        image_size: { width: 768, height: 1024 },
        num_inference_steps: 28,
        guidance_scale: 3.5,
        enable_safety_checker: false,
      };

    case 'flux-lora':
      return {
        ...baseParams,
        image_size: { width: 768, height: 1024 },
        num_inference_steps: 28,
        guidance_scale: 3.5,
        loras: loras || [],
        enable_safety_checker: false,
      };

    case 'dreamina':
      return {
        ...baseParams,
        negative_prompt: NEGATIVE_PROMPT,
        image_size: { width: 768, height: 1024 },
        enable_safety_checker: false,
      };

    default:
      return baseParams;
  }
}

async function testModel(
  modelKey: string,
  modelPath: string,
  promptSpec: typeof TEST_PROMPTS[0],
  loraSpec?: typeof LORAS[0]
): Promise<void> {
  const loraName = loraSpec?.name || 'default';
  const filename = `${modelKey}_${promptSpec.name}_${loraName}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);

  // Skip if already exists
  if (fs.existsSync(filepath)) {
    console.log(`  ⏭️  Skipping (exists): ${filename}`);
    return;
  }

  console.log(`\n  Generating: ${filename}`);
  console.log(`  Model: ${modelPath}`);

  try {
    const params = getModelParams(modelKey, promptSpec.prompt, loraSpec?.loras);
    console.log(`  Params: ${JSON.stringify({ ...params, prompt: params.prompt.substring(0, 50) + '...' })}`);

    const queueResponse = await submitToFal(modelPath, params);
    console.log(`  Request ID: ${queueResponse.request_id}`);

    const result = await pollForResult(queueResponse.status_url, queueResponse.response_url);

    const imageUrl = result.images?.[0]?.url || result.data?.[0]?.url;
    if (!imageUrl) {
      console.log(`  ❌ No image URL in response: ${JSON.stringify(result).substring(0, 200)}`);
      return;
    }

    await downloadImage(imageUrl, filepath);
    console.log(`  ✅ Saved: ${filename}`);
  } catch (error) {
    console.log(`  ❌ Failed: ${error}`);
  }
}

async function main() {
  if (!FAL_API_KEY) {
    console.error('Error: FAL_API_KEY required');
    process.exit(1);
  }

  // Parse args
  const args = process.argv.slice(2);
  const modelFilter = args.find(a => a.startsWith('--model='))?.split('=')[1];
  const promptFilter = args.find(a => a.startsWith('--prompt='))?.split('=')[1];

  // Create output dir
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('\n=== FAL Model Comparison Test ===\n');
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Models: ${Object.keys(MODELS).join(', ')}`);
  console.log(`Prompts: ${TEST_PROMPTS.map(p => p.name).join(', ')}`);

  // Filter models if specified
  const modelsToTest = modelFilter
    ? Object.entries(MODELS).filter(([key]) => key.includes(modelFilter))
    : Object.entries(MODELS);

  // Filter prompts if specified
  const promptsToTest = promptFilter
    ? TEST_PROMPTS.filter(p => p.name.includes(promptFilter))
    : TEST_PROMPTS;

  console.log(`\nTesting ${modelsToTest.length} models × ${promptsToTest.length} prompts = ${modelsToTest.length * promptsToTest.length} images\n`);

  for (const [modelKey, modelPath] of modelsToTest) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`MODEL: ${modelKey} (${modelPath})`);
    console.log('='.repeat(60));

    for (const promptSpec of promptsToTest) {
      if (modelKey === 'flux-lora') {
        // Test with different LoRA configs
        for (const loraSpec of LORAS) {
          await testModel(modelKey, modelPath, promptSpec, loraSpec);
        }
      } else {
        await testModel(modelKey, modelPath, promptSpec);
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('\n\n=== Test Complete ===');
  console.log(`Check results in: ${OUTPUT_DIR}`);

  // List generated files
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
  console.log(`\nGenerated ${files.length} images:`);
  for (const file of files) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, file));
    console.log(`  - ${file} (${Math.round(stat.size / 1024)}KB)`);
  }
}

main().catch(console.error);
