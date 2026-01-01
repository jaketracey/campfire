/**
 * Generate Base Images for Marketing and Onboarding
 *
 * This script generates companion avatar images for various emotional states
 * and saves them to the public folders for marketing and web packages.
 *
 * Usage: npx tsx scripts/generate-base-images.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAL_API_KEY = process.env.FAL_API_KEY || '';
const FAL_BASE_URL = 'https://queue.fal.run';
const FAL_MODEL = 'fal-ai/flux/schnell';

interface ImageConfig {
  name: string;
  prompt: string;
  emotionalState: string;
  style: string;
  width: number;
  height: number;
}

const basePrompts: Record<string, string> = {
  realistic: 'Portrait of a friendly AI companion, human-like appearance, professional headshot',
  stylized: 'Friendly 3D animated character companion, expressive face, warm presence, Pixar style',
  abstract: 'Abstract representation of an AI companion, glowing orb with ethereal features',
  minimal: 'Minimalist avatar, simple geometric face, clean design, friendly expression',
  anime: 'Anime-style AI companion character, expressive eyes, friendly demeanor',
};

const emotionalModifiers: Record<string, string> = {
  happy: 'warm smile, bright eyes, joyful expression, uplifting mood',
  calm: 'serene expression, peaceful, relaxed posture, gentle lighting',
  curious: 'inquisitive look, tilted head, engaged expression, alert',
  excited: 'energetic, bright expression, dynamic pose, enthusiastic',
  thoughtful: 'contemplative gaze, pensive expression, soft focus',
  supportive: 'empathetic expression, warm gaze, open posture, comforting',
  playful: 'mischievous smile, sparkling eyes, dynamic, fun',
  neutral: 'calm neutral expression, attentive, present',
};

// Images to generate for marketing pages
const marketingImages: ImageConfig[] = [
  {
    name: 'hero-companion-happy',
    prompt: `${basePrompts.stylized}, ${emotionalModifiers.happy}, high quality, detailed`,
    emotionalState: 'happy',
    style: 'stylized',
    width: 400,
    height: 600,
  },
  {
    name: 'hero-companion-calm',
    prompt: `${basePrompts.stylized}, ${emotionalModifiers.calm}, high quality, detailed`,
    emotionalState: 'calm',
    style: 'stylized',
    width: 400,
    height: 600,
  },
  {
    name: 'feature-supportive',
    prompt: `${basePrompts.stylized}, ${emotionalModifiers.supportive}, high quality, detailed`,
    emotionalState: 'supportive',
    style: 'stylized',
    width: 300,
    height: 400,
  },
  {
    name: 'feature-curious',
    prompt: `${basePrompts.stylized}, ${emotionalModifiers.curious}, high quality, detailed`,
    emotionalState: 'curious',
    style: 'stylized',
    width: 300,
    height: 400,
  },
];

// Images to generate for onboarding
const onboardingImages: ImageConfig[] = [
  // Realistic style previews
  {
    name: 'preview-realistic-neutral',
    prompt: `${basePrompts.realistic}, ${emotionalModifiers.neutral}, high quality, detailed, 8k`,
    emotionalState: 'neutral',
    style: 'realistic',
    width: 250,
    height: 400,
  },
  // Stylized style previews
  {
    name: 'preview-stylized-neutral',
    prompt: `${basePrompts.stylized}, ${emotionalModifiers.neutral}, high quality, detailed`,
    emotionalState: 'neutral',
    style: 'stylized',
    width: 250,
    height: 400,
  },
  // Abstract style previews
  {
    name: 'preview-abstract-neutral',
    prompt: `${basePrompts.abstract}, ${emotionalModifiers.neutral}, high quality, modern art`,
    emotionalState: 'neutral',
    style: 'abstract',
    width: 250,
    height: 400,
  },
  // Minimal style previews
  {
    name: 'preview-minimal-neutral',
    prompt: `${basePrompts.minimal}, ${emotionalModifiers.neutral}, clean design`,
    emotionalState: 'neutral',
    style: 'minimal',
    width: 250,
    height: 400,
  },
  // Emotional state variations
  ...Object.entries(emotionalModifiers).map(([state, modifier]) => ({
    name: `emotion-${state}`,
    prompt: `${basePrompts.stylized}, ${modifier}, high quality, detailed`,
    emotionalState: state,
    style: 'stylized',
    width: 250,
    height: 400,
  })),
];

async function pollForResult(requestId: string): Promise<any> {
  const statusUrl = `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/${FAL_MODEL}/requests/${requestId}`;
  const maxWait = 120000;
  const pollInterval = 500;
  let elapsed = 0;

  while (elapsed < maxWait) {
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });

    if (!statusResponse.ok) {
      throw new Error(`FAL status check failed: ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();

    if (statusData.status === 'COMPLETED') {
      const resultResponse = await fetch(resultUrl, {
        headers: { Authorization: `Key ${FAL_API_KEY}` },
      });
      return resultResponse.json();
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`FAL generation failed: ${statusData.error || 'Unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  throw new Error(`Request ${requestId} timed out`);
}

async function generateImage(config: ImageConfig): Promise<string> {
  console.log(`Generating: ${config.name}...`);

  const inputParams = {
    prompt: config.prompt,
    image_size: { width: config.width, height: config.height },
    num_images: 1,
    enable_safety_checker: true,
  };

  const response = await fetch(`${FAL_BASE_URL}/${FAL_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(inputParams),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`FAL API error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const requestId = result.request_id;

  let imageUrl: string;
  if (requestId) {
    const finalResult = await pollForResult(requestId);
    imageUrl = finalResult.images?.[0]?.url;
  } else {
    imageUrl = result.images?.[0]?.url;
  }

  if (!imageUrl) {
    throw new Error('No image URL in response');
  }

  return imageUrl;
}

async function downloadImage(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buffer));
  console.log(`Saved: ${filePath}`);
}

async function generateAndSaveImages(
  configs: ImageConfig[],
  outputDir: string
): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const config of configs) {
    try {
      const imageUrl = await generateImage(config);
      const filePath = path.join(outputDir, `${config.name}.png`);
      await downloadImage(imageUrl, filePath);

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to generate ${config.name}:`, error);
    }
  }
}

async function main() {
  if (!FAL_API_KEY) {
    console.error('Error: FAL_API_KEY environment variable not set');
    console.log('Usage: FAL_API_KEY=your-key npx tsx scripts/generate-base-images.ts');
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const marketingOutputDir = path.join(projectRoot, 'packages/marketing/public/generated');
  const webOutputDir = path.join(projectRoot, 'packages/web/public/generated');

  console.log('=== Generating Marketing Images ===');
  await generateAndSaveImages(marketingImages, marketingOutputDir);

  console.log('\n=== Generating Onboarding Images ===');
  await generateAndSaveImages(onboardingImages, webOutputDir);

  // Create an index file for easy reference
  const indexContent = {
    marketing: marketingImages.map((c) => ({
      name: c.name,
      path: `/generated/${c.name}.png`,
      emotionalState: c.emotionalState,
      style: c.style,
    })),
    onboarding: onboardingImages.map((c) => ({
      name: c.name,
      path: `/generated/${c.name}.png`,
      emotionalState: c.emotionalState,
      style: c.style,
    })),
  };

  fs.writeFileSync(
    path.join(webOutputDir, 'index.json'),
    JSON.stringify(indexContent, null, 2)
  );

  console.log('\nDone! Generated images saved to:');
  console.log(`  Marketing: ${marketingOutputDir}`);
  console.log(`  Web: ${webOutputDir}`);
}

main().catch(console.error);
