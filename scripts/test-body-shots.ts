/**
 * Test script for generating body-shot companion images
 * Tests 3 women and 3 men with different body types and ages
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAL_API_KEY = process.env.FAL_API_KEY || '';
const FAL_BASE_URL = 'https://queue.fal.run';
const FAL_MODEL = 'fal-ai/bytedance/dreamina/v3.1/text-to-image';

const OUTPUT_DIR = path.join(__dirname, '../packages/web/public/images/companions/test');

// Image dimensions (portrait)
const IMAGE_WIDTH = 768;
const IMAGE_HEIGHT = 1024;

interface TestSpec {
  gender: 'female' | 'male';
  ethnicity: string;
  bodyType: string;
  age: 'young' | 'adult' | 'mature';
  name: string;
  prompt: string;
}

// Age descriptions
const AGE_RANGES = {
  young: { female: '22-26', male: '24-28' },
  adult: { female: '30-38', male: '32-40' },
  mature: { female: '42-50', male: '45-55' },
};

const AGE_VIBES = {
  young: 'youthful energy, fresh-faced',
  adult: 'confident maturity, in their prime',
  mature: 'distinguished elegance, graceful aging',
};

// Test specifications - 3 women, 3 men with varied body types and ages
const TEST_SPECS: TestSpec[] = [
  // Women
  {
    gender: 'female',
    ethnicity: 'caucasian',
    bodyType: 'athletic',
    age: 'young',
    name: 'female-caucasian-athletic-young',
    prompt: '',
  },
  {
    gender: 'female',
    ethnicity: 'latina',
    bodyType: 'curvy',
    age: 'adult',
    name: 'female-latina-curvy-adult',
    prompt: '',
  },
  {
    gender: 'female',
    ethnicity: 'east-asian',
    bodyType: 'slim',
    age: 'mature',
    name: 'female-east-asian-slim-mature',
    prompt: '',
  },
  // Men
  {
    gender: 'male',
    ethnicity: 'black',
    bodyType: 'muscular',
    age: 'young',
    name: 'male-black-muscular-young',
    prompt: '',
  },
  {
    gender: 'male',
    ethnicity: 'south-asian',
    bodyType: 'athletic',
    age: 'adult',
    name: 'male-south-asian-athletic-adult',
    prompt: '',
  },
  {
    gender: 'male',
    ethnicity: 'middle-eastern',
    bodyType: 'dad-bod',
    age: 'mature',
    name: 'male-middle-eastern-dadbod-mature',
    prompt: '',
  },
];

// Ethnicity descriptions
const ETHNICITY_DESC: Record<string, { female: string; male: string }> = {
  'caucasian': { female: 'Caucasian woman with fair skin', male: 'Caucasian man with light skin' },
  'latina': { female: 'Latina woman with warm olive skin', male: 'Latino man with golden-tan skin' },
  'east-asian': { female: 'East Asian woman with delicate features', male: 'East Asian man with refined features' },
  'black': { female: 'Black woman with beautiful dark skin', male: 'Black man with rich dark skin' },
  'south-asian': { female: 'South Asian woman with warm brown skin', male: 'South Asian man with warm brown skin' },
  'middle-eastern': { female: 'Middle Eastern woman with olive skin', male: 'Middle Eastern man with olive complexion' },
};

// Body type descriptions for gym/fitness context
const BODY_TYPE_DESC: Record<string, { female: string; male: string }> = {
  'slim': {
    female: 'slim and toned figure in form-fitting workout wear',
    male: 'lean and toned physique in fitted athletic wear',
  },
  'athletic': {
    female: 'athletic and fit figure in stylish gym attire',
    male: 'athletic and muscular build in gym tank top',
  },
  'curvy': {
    female: 'curvy and fit figure in flattering activewear',
    male: 'solid and strong build in athletic shorts and shirt',
  },
  'muscular': {
    female: 'toned muscular figure in sports bra and leggings',
    male: 'muscular and defined physique in compression wear',
  },
  'plus-size': {
    female: 'plus-size figure confidently wearing athleisure',
    male: 'larger build with strong presence in workout clothes',
  },
  'dad-bod': {
    female: 'soft curves in comfortable workout outfit',
    male: 'average dad-bod build in casual gym attire',
  },
};

function buildBodyShotPrompt(spec: TestSpec): string {
  const ethnicityDesc = ETHNICITY_DESC[spec.ethnicity]?.[spec.gender] ||
    `${spec.ethnicity} ${spec.gender === 'female' ? 'woman' : 'man'}`;

  const bodyDesc = BODY_TYPE_DESC[spec.bodyType]?.[spec.gender] ||
    `${spec.bodyType} build in athletic wear`;

  const ageRange = AGE_RANGES[spec.age][spec.gender];
  const ageVibe = AGE_VIBES[spec.age];

  // Build a body-focused prompt (not just facial close-up)
  const prompt = [
    // Subject - full body context
    `Three-quarter body portrait of a ${ageRange} year old ${ethnicityDesc}`,
    `with ${bodyDesc}.`,

    // Age vibe
    `${ageVibe}.`,

    // Pose and setting - gym/fitness context
    `Standing confidently in a modern gym or fitness studio.`,
    `Natural lighting through large windows.`,

    // Expression
    `Warm, approachable expression, slight smile.`,
    `Looking at the camera with genuine confidence.`,

    // Technical
    `Professional fitness photography.`,
    `Full body visible from mid-thigh up.`,
    `Sony A7R IV, 50mm f/1.8 lens.`,
    `8K resolution, photorealistic, natural skin texture.`,
  ].join(' ');

  return prompt;
}

const NEGATIVE_PROMPT = [
  'ugly', 'deformed', 'disfigured', 'low quality', 'blurry', 'pixelated',
  'bad anatomy', 'extra limbs', 'missing limbs', 'bad hands', 'extra fingers',
  'watermark', 'text', 'signature', 'logo', 'cartoon', 'anime', '3d render',
  'plastic skin', 'wax figure', 'mannequin', 'artificial', 'oversaturated',
  'nude', 'nsfw', 'explicit'
].join(', ');

// FAL API functions
interface FalQueueResponse {
  status_url: string;
  response_url: string;
  request_id: string;
}

interface FalResult {
  images: Array<{ url: string }>;
}

async function submitToFal(prompt: string): Promise<FalQueueResponse> {
  const response = await fetch(`${FAL_BASE_URL}/${FAL_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      negative_prompt: NEGATIVE_PROMPT,
      image_size: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
      num_images: 1,
      enable_safety_checker: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`FAL submit failed: ${response.status} - ${error}`);
  }

  return response.json();
}

async function pollForResult(statusUrl: string, responseUrl: string): Promise<string> {
  const maxWait = 180000; // 3 minutes
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
    console.log(`  Status: ${status.status}`);

    if (status.status === 'COMPLETED') {
      const resultResponse = await fetch(responseUrl, {
        headers: { 'Authorization': `Key ${FAL_API_KEY}` },
      });

      if (!resultResponse.ok) {
        throw new Error(`Result fetch failed: ${resultResponse.status}`);
      }

      const result: FalResult = await resultResponse.json();
      return result.images[0].url;
    }

    if (status.status === 'FAILED') {
      throw new Error(`Generation failed: ${JSON.stringify(status)}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  throw new Error(`Request timed out after ${maxWait / 1000}s`);
}

async function downloadImage(url: string, filepath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filepath, Buffer.from(buffer));
}

async function main() {
  if (!FAL_API_KEY) {
    console.error('Error: FAL_API_KEY environment variable is required');
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`\nOutput directory: ${OUTPUT_DIR}\n`);

  // Generate prompts
  const specs = TEST_SPECS.map(spec => ({
    ...spec,
    prompt: buildBodyShotPrompt(spec),
  }));

  console.log('Test Image Specifications:');
  console.log('='.repeat(80));
  for (const spec of specs) {
    console.log(`\n${spec.name}:`);
    console.log(`  Prompt: ${spec.prompt.substring(0, 100)}...`);
  }
  console.log('\n' + '='.repeat(80));

  // Generate images sequentially
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    console.log(`\n[${i + 1}/${specs.length}] Generating: ${spec.name}`);
    console.log(`  Full prompt: ${spec.prompt}`);

    try {
      const queueResponse = await submitToFal(spec.prompt);
      console.log(`  Request ID: ${queueResponse.request_id}`);

      const imageUrl = await pollForResult(queueResponse.status_url, queueResponse.response_url);
      console.log(`  Image URL: ${imageUrl}`);

      const filepath = path.join(OUTPUT_DIR, `${spec.name}.png`);
      await downloadImage(imageUrl, filepath);
      console.log(`  ✅ Saved: ${filepath}`);
    } catch (error) {
      console.error(`  ❌ Failed: ${error}`);
    }

    // Small delay between generations
    if (i < specs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n✅ Done! Check the test folder for generated images.');
}

main().catch(console.error);
