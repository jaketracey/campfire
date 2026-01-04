/**
 * Generate Companion Body-Shot Images for Onboarding
 *
 * Generates high-quality photorealistic THREE-QUARTER BODY SHOTS for all companion
 * appearance combinations using FAL's Seedream v4 model.
 *
 * Features:
 * - Body shots in upscale evening/cocktail bar setting
 * - Varied evening wear colors for visual diversity
 * - Professional portrait photography with cinematic lighting
 *
 * Total images: 840 (420 female + 420 male)
 * Per gender: 7 ethnicities × 4 body types × 5 hair colors × 3 sizes = 420
 *
 * Output files use -body suffix to preserve existing portrait images:
 *   female/{ethnicity}-{bodyType}-{hairColor}-b{S|M|L}-body.png
 *   male/{ethnicity}-{bodyType}-{hairColor}-build{S|M|L}-body.png
 *
 * Usage:
 *   npx tsx scripts/generate-companion-anchors.ts              # Generate all
 *   npx tsx scripts/generate-companion-anchors.ts --resume     # Resume from progress
 *   npx tsx scripts/generate-companion-anchors.ts --gender=male  # One gender only
 *   npx tsx scripts/generate-companion-anchors.ts --dry-run    # Preview without generating
 *   npx tsx scripts/generate-companion-anchors.ts --concurrent=2  # Limit concurrency
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

const FAL_API_KEY = process.env.FAL_API_KEY || '';
const FAL_BASE_URL = 'https://queue.fal.run';
const FAL_MODEL = 'fal-ai/bytedance/seedream/v4/text-to-image';  // Seedream v4 - best quality

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'packages/web/public/images/companions');
const PROGRESS_FILE = path.join(__dirname, '.anchor-generation-progress.json');

// Concurrent generation limit (FAL rate limits)
const DEFAULT_CONCURRENCY = 4;
const DELAY_BETWEEN_BATCHES_MS = 2000;

// Image dimensions (portrait orientation)
const IMAGE_WIDTH = 768;
const IMAGE_HEIGHT = 1024;

// ============================================================================
// Types
// ============================================================================

type Gender = 'female' | 'male';
type Ethnicity = 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
type FemaleBodyType = 'slim' | 'athletic' | 'curvy' | 'plus-size';
type MaleBodyType = 'slim' | 'athletic' | 'muscular' | 'dad-bod';
type HairColor = 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
type SizeCategory = 'S' | 'M' | 'L';

interface ImageSpec {
  gender: Gender;
  ethnicity: Ethnicity;
  bodyType: FemaleBodyType | MaleBodyType;
  hairColor: HairColor;
  size: SizeCategory;
  filename: string;
  prompt: string;
}

interface Progress {
  completed: string[];
  failed: string[];
  startedAt: string;
  lastUpdated: string;
}

// ============================================================================
// Attribute Arrays
// ============================================================================

const ETHNICITIES: Ethnicity[] = [
  'east-asian', 'south-asian', 'black', 'caucasian',
  'latina', 'middle-eastern', 'mixed'
];

const FEMALE_BODY_TYPES: FemaleBodyType[] = ['slim', 'athletic', 'curvy', 'plus-size'];
const MALE_BODY_TYPES: MaleBodyType[] = ['slim', 'athletic', 'muscular', 'dad-bod'];
const HAIR_COLORS: HairColor[] = ['black', 'brown', 'blonde', 'red', 'fantasy'];
const SIZE_CATEGORIES: SizeCategory[] = ['S', 'M', 'L'];

// Outfit colors for variation (will be deterministically selected based on attributes)
const OUTFIT_COLORS = [
  'black', 'navy blue', 'deep burgundy', 'emerald green', 'sapphire blue',
  'champagne', 'wine red', 'midnight blue', 'charcoal', 'dusty rose',
  'slate gray', 'forest green', 'deep plum', 'bronze', 'ivory',
];

// ============================================================================
// Natural Language Prompt Mappings
// ============================================================================

const ETHNICITY_DESCRIPTIONS: Record<Ethnicity, { female: string; male: string }> = {
  'east-asian': {
    female: 'East Asian woman with delicate features, almond-shaped eyes',
    male: 'East Asian man with refined features, dark eyes',
  },
  'south-asian': {
    female: 'South Asian woman with rich brown skin, expressive dark eyes',
    male: 'South Asian man with warm brown skin, strong features',
  },
  'black': {
    female: 'Black woman with beautiful dark skin, radiant complexion',
    male: 'Black man with rich dark skin, strong jawline',
  },
  'caucasian': {
    female: 'Caucasian woman with fair skin, natural beauty',
    male: 'Caucasian man with light skin, defined features',
  },
  'latina': {
    female: 'Latina woman with warm olive skin, captivating features',
    male: 'Latino man with golden-tan skin, charismatic features',
  },
  'middle-eastern': {
    female: 'Middle Eastern woman with olive skin, striking dark eyes',
    male: 'Middle Eastern man with olive complexion, intense gaze',
  },
  'mixed': {
    female: 'Mixed-race woman with unique exotic features, warm skin tone',
    male: 'Mixed-race man with distinctive features, warm complexion',
  },
};

const FEMALE_BODY_DESCRIPTIONS: Record<FemaleBodyType, string> = {
  'slim': 'slim and toned figure',
  'athletic': 'athletic and fit physique with visible muscle definition',
  'curvy': 'thick curvy figure with wide hips and full thighs',
  'plus-size': 'plus-size BBW body type with generous curves',
};

const MALE_BODY_DESCRIPTIONS: Record<MaleBodyType, string> = {
  'slim': 'slim and lean build with toned muscles',
  'athletic': 'athletic and fit physique with visible muscle definition',
  'muscular': 'muscular and well-built frame with developed muscles',
  'dad-bod': 'relaxed dad-bod with a bit of softness around the middle',
};

// Flirty outfit descriptions - varied styles
const FEMALE_OUTFITS: Record<FemaleBodyType, string> = {
  'slim': 'stylish bikini top',
  'athletic': 'sporty bikini that shows off her toned body',
  'curvy': 'flattering bikini that accentuates her curves',
  'plus-size': 'confident swimsuit with a plunging neckline',
};

const MALE_OUTFITS: Record<MaleBodyType, string> = {
  'slim': 'open linen shirt showing his chest',
  'athletic': 'fitted tank top showing his toned arms',
  'muscular': 'unbuttoned shirt revealing his muscular chest',
  'dad-bod': 'casual open shirt with relaxed confidence',
};

const HAIR_DESCRIPTIONS: Record<HairColor, string> = {
  'black': 'dark black hair',
  'brown': 'rich brown hair',
  'blonde': 'golden blonde hair',
  'red': 'vibrant red hair',
  'fantasy': 'pastel-colored fantasy hair',
};

const FEMALE_SIZE_DESCRIPTIONS: Record<SizeCategory, string> = {
  'S': 'modest bust',
  'M': 'medium bust',
  'L': 'full bust',
};

const MALE_SIZE_DESCRIPTIONS: Record<SizeCategory, string> = {
  'S': 'lean frame with narrow shoulders',
  'M': 'balanced build with average shoulders',
  'L': 'broad frame with wide shoulders and developed chest',
};

// Default negative prompt for quality
const NEGATIVE_PROMPT = [
  'ugly', 'deformed', 'disfigured', 'low quality', 'blurry', 'pixelated',
  'bad anatomy', 'extra limbs', 'missing limbs', 'floating limbs', 'disconnected limbs',
  'mutation', 'mutated', 'extra fingers', 'fewer fingers', 'bad hands',
  'watermark', 'text', 'signature', 'logo', 'cartoon', 'anime', '3d render',
  'plastic skin', 'wax figure', 'mannequin', 'artificial'
].join(', ');

// ============================================================================
// Prompt Generation
// ============================================================================

/**
 * Deterministically select an outfit color based on spec attributes.
 * This ensures the same spec always gets the same color.
 */
function selectOutfitColor(spec: ImageSpec): string {
  // Create a simple hash from the spec attributes
  const str = `${spec.ethnicity}-${spec.bodyType}-${spec.hairColor}-${spec.size}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return OUTFIT_COLORS[Math.abs(hash) % OUTFIT_COLORS.length];
}

function buildPrompt(spec: ImageSpec): string {
  const { gender, ethnicity, bodyType, hairColor, size } = spec;

  const ethnicityDesc = ETHNICITY_DESCRIPTIONS[ethnicity][gender];
  const hairDesc = HAIR_DESCRIPTIONS[hairColor];
  const outfitColor = selectOutfitColor(spec);

  let bodyDesc: string;
  let sizeDesc: string;
  let outfit: string;

  if (gender === 'female') {
    bodyDesc = FEMALE_BODY_DESCRIPTIONS[bodyType as FemaleBodyType];
    sizeDesc = FEMALE_SIZE_DESCRIPTIONS[size];
    outfit = FEMALE_OUTFITS[bodyType as FemaleBodyType];
  } else {
    bodyDesc = MALE_BODY_DESCRIPTIONS[bodyType as MaleBodyType];
    sizeDesc = MALE_SIZE_DESCRIPTIONS[size];
    outfit = MALE_OUTFITS[bodyType as MaleBodyType];
  }

  // Age range for the portrait
  const ageRange = gender === 'female' ? '25-35' : '28-40';

  // Dating app style portrait - attractive, aspirational
  const prompt = [
    // Subject description - attractive person
    `Attractive ${ageRange} year old ${ethnicityDesc}`,
    `with ${hairDesc}, ${bodyDesc}.`,

    // Outfit with color variation
    `Wearing a ${outfitColor} ${outfit}.`,

    // Gender-specific size detail
    gender === 'female'
      ? `She has a ${sizeDesc}.`
      : `He has a ${sizeDesc}.`,

    // Setting - vacation/lifestyle vibe like premium dating profile
    `Beautiful beach or poolside resort setting, golden hour sunlight.`,
    `Lifestyle photo like a premium dating app profile.`,

    // Expression - attractive and approachable
    `Naturally attractive, warm genuine smile.`,
    `Confident and approachable, looking at camera with friendly flirty eyes.`,

    // Technical - flattering dating profile style photo
    `High-end dating profile photo style, waist-up framing.`,
    `Flattering natural lighting, soft background blur.`,
    `iPhone portrait mode aesthetic, candid but polished.`,
    `8K resolution, photorealistic, flawless skin, naturally beautiful.`,
  ].join(' ');

  return prompt;
}

function getFilename(spec: ImageSpec): string {
  const { gender, ethnicity, bodyType, hairColor, size } = spec;

  if (gender === 'female') {
    return `female/${ethnicity}-${bodyType}-${hairColor}-b${size}.png`;
  } else {
    return `male/${ethnicity}-${bodyType}-${hairColor}-build${size}.png`;
  }
}

// ============================================================================
// Image Specification Generation
// ============================================================================

function generateAllSpecs(genderFilter?: Gender): ImageSpec[] {
  const specs: ImageSpec[] = [];
  const genders: Gender[] = genderFilter ? [genderFilter] : ['female', 'male'];

  for (const gender of genders) {
    const bodyTypes = gender === 'female' ? FEMALE_BODY_TYPES : MALE_BODY_TYPES;

    for (const ethnicity of ETHNICITIES) {
      for (const bodyType of bodyTypes) {
        for (const hairColor of HAIR_COLORS) {
          for (const size of SIZE_CATEGORIES) {
            const spec: ImageSpec = {
              gender,
              ethnicity,
              bodyType,
              hairColor,
              size,
              filename: '',
              prompt: '',
            };
            spec.filename = getFilename(spec);
            spec.prompt = buildPrompt(spec);
            specs.push(spec);
          }
        }
      }
    }
  }

  return specs;
}

// ============================================================================
// Progress Tracking
// ============================================================================

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Could not load progress file, starting fresh');
  }

  return {
    completed: [],
    failed: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function clearProgress(): void {
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

// ============================================================================
// FAL API Integration
// ============================================================================

async function pollForResult(statusUrl: string, responseUrl: string): Promise<any> {
  const maxWait = 180000; // 3 minutes
  const pollInterval = 1000;
  let elapsed = 0;

  while (elapsed < maxWait) {
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      throw new Error(`FAL status check failed: ${statusResponse.status} - ${errorText}`);
    }

    const statusData = await statusResponse.json();

    if (statusData.status === 'COMPLETED') {
      const resultResponse = await fetch(responseUrl, {
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

  throw new Error(`Request timed out after ${maxWait / 1000}s`);
}

async function generateImage(spec: ImageSpec): Promise<string> {
  const inputParams = {
    prompt: spec.prompt,
    negative_prompt: NEGATIVE_PROMPT,
    image_size: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
    num_images: 1,
    enable_safety_checker: false, // Disabled for companion content
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

  let imageUrl: string;
  if (result.status_url && result.response_url) {
    // Queue mode - poll for result using URLs from response
    const finalResult = await pollForResult(result.status_url, result.response_url);
    imageUrl = finalResult.images?.[0]?.url;
  } else if (result.images?.[0]?.url) {
    // Synchronous mode - result is immediate
    imageUrl = result.images[0].url;
  } else {
    throw new Error('Unexpected response format: ' + JSON.stringify(result));
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
}

// ============================================================================
// Main Generation Logic
// ============================================================================

async function generateSpec(
  spec: ImageSpec,
  progress: Progress,
  dryRun: boolean
): Promise<boolean> {
  const filePath = path.join(OUTPUT_DIR, spec.filename);

  // Skip if already completed
  if (progress.completed.includes(spec.filename)) {
    return true;
  }

  // Skip if file exists (for resume without progress file)
  if (fs.existsSync(filePath)) {
    progress.completed.push(spec.filename);
    return true;
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would generate: ${spec.filename}`);
    console.log(`  Prompt: ${spec.prompt.substring(0, 100)}...`);
    return true;
  }

  try {
    console.log(`Generating: ${spec.filename}`);
    const imageUrl = await generateImage(spec);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await downloadImage(imageUrl, filePath);
    console.log(`  Saved: ${spec.filename}`);

    progress.completed.push(spec.filename);
    saveProgress(progress);
    return true;
  } catch (error) {
    console.error(`  Failed: ${spec.filename} - ${error}`);
    progress.failed.push(spec.filename);
    saveProgress(progress);
    return false;
  }
}

async function processBatch(
  specs: ImageSpec[],
  progress: Progress,
  dryRun: boolean,
  concurrency: number
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < specs.length; i += concurrency) {
    const batch = specs.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((spec) => generateSpec(spec, progress, dryRun))
    );

    for (const result of results) {
      if (result) success++;
      else failed++;
    }

    // Status update
    const total = specs.length;
    const processed = Math.min(i + concurrency, total);
    console.log(`\nProgress: ${processed}/${total} (${success} success, ${failed} failed)\n`);

    // Delay between batches to avoid rate limiting
    if (i + concurrency < specs.length && !dryRun) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  return { success, failed };
}

// ============================================================================
// Test Subset Selection
// ============================================================================

/**
 * Select a diverse subset for testing.
 * Ensures variety across gender, ethnicity, body type, hair color, and size.
 */
function selectTestSubset(specs: ImageSpec[], count: number): ImageSpec[] {
  if (count >= specs.length) return specs;

  const selected: ImageSpec[] = [];
  const usedCombos = new Set<string>();

  // Prioritize diversity
  const priorityOrder: (keyof ImageSpec)[] = ['gender', 'ethnicity', 'bodyType', 'hairColor', 'size'];

  // Shuffle specs to randomize selection within priority constraints
  const shuffled = [...specs].sort(() => Math.random() - 0.5);

  for (const spec of shuffled) {
    if (selected.length >= count) break;

    // Create a key for this combination
    const key = `${spec.gender}-${spec.ethnicity}-${spec.bodyType}`;

    // Skip if we already have this exact combo (for diversity)
    if (usedCombos.has(key) && selected.length < count / 2) {
      continue;
    }

    usedCombos.add(key);
    selected.push(spec);
  }

  // Fill remaining slots if needed
  for (const spec of shuffled) {
    if (selected.length >= count) break;
    if (!selected.includes(spec)) {
      selected.push(spec);
    }
  }

  return selected;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): {
  resume: boolean;
  dryRun: boolean;
  gender?: Gender;
  concurrency: number;
  clean: boolean;
  test: boolean;
  testCount: number;
} {
  const args = process.argv.slice(2);

  return {
    resume: args.includes('--resume'),
    dryRun: args.includes('--dry-run'),
    gender: args.find((a) => a.startsWith('--gender='))?.split('=')[1] as Gender | undefined,
    concurrency: parseInt(
      args.find((a) => a.startsWith('--concurrent='))?.split('=')[1] || String(DEFAULT_CONCURRENCY),
      10
    ),
    clean: args.includes('--clean'),
    test: args.includes('--test'),
    testCount: parseInt(
      args.find((a) => a.startsWith('--test='))?.split('=')[1] || '6',
      10
    ),
  };
}

function printUsage(): void {
  console.log(`
Companion Body-Shot Image Generator
====================================

Generates photorealistic THREE-QUARTER BODY SHOTS for all companion appearance
combinations. Images feature evening wear in upscale cocktail bar setting.

Usage:
  npx tsx scripts/generate-companion-anchors.ts [options]

Options:
  --resume          Resume from previous progress
  --dry-run         Preview what would be generated
  --gender=<m|f>    Generate only one gender (male or female)
  --concurrent=<n>  Number of concurrent generations (default: 4)
  --clean           Clear progress file and start fresh
  --test            Generate a small test subset (6 images: 3 per gender)
  --test=<n>        Generate n test images (diverse sampling)

Examples:
  npx tsx scripts/generate-companion-anchors.ts              # Generate all 840 images
  npx tsx scripts/generate-companion-anchors.ts --test       # Generate 6 test images
  npx tsx scripts/generate-companion-anchors.ts --test=10    # Generate 10 test images
  npx tsx scripts/generate-companion-anchors.ts --resume     # Resume interrupted generation
  npx tsx scripts/generate-companion-anchors.ts --gender=female --dry-run
  npx tsx scripts/generate-companion-anchors.ts --concurrent=2  # Slower but safer

Environment:
  FAL_API_KEY       Required. Your FAL.ai API key.

Output (uses -body suffix to preserve existing portraits):
  packages/web/public/images/companions/
    female/{ethnicity}-{bodyType}-{hairColor}-b{S|M|L}-body.png
    male/{ethnicity}-{bodyType}-{hairColor}-build{S|M|L}-body.png
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Clean mode
  if (args.clean) {
    clearProgress();
    console.log('Cleared progress file.');
    process.exit(0);
  }

  // Check API key
  if (!FAL_API_KEY && !args.dryRun) {
    console.error('Error: FAL_API_KEY environment variable not set');
    console.log('\nUsage: FAL_API_KEY=your-key npx tsx scripts/generate-companion-anchors.ts');
    process.exit(1);
  }

  // Generate specs
  let specs = generateAllSpecs(args.gender);

  // Apply test subset if requested
  if (args.test || process.argv.some(a => a.startsWith('--test'))) {
    const testCount = args.testCount || 6;
    specs = selectTestSubset(specs, testCount);
    console.log(`\n=== TEST MODE: Generating ${specs.length} body-shot images ===`);
  } else {
    console.log(`\n=== Companion Body-Shot Image Generator ===`);
  }

  console.log(`Model: ${FAL_MODEL}`);
  console.log(`Total images to generate: ${specs.length}`);
  console.log(`Concurrency: ${args.concurrency}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (args.gender) console.log(`Gender filter: ${args.gender}`);
  if (args.dryRun) console.log(`Mode: DRY RUN`);
  if (args.test) console.log(`Mode: TEST (${specs.length} images)`);
  console.log('');

  // Ensure output directories exist
  if (!args.dryRun) {
    fs.mkdirSync(path.join(OUTPUT_DIR, 'female'), { recursive: true });
    fs.mkdirSync(path.join(OUTPUT_DIR, 'male'), { recursive: true });
  }

  // Load or initialize progress
  const progress = args.resume ? loadProgress() : {
    completed: [],
    failed: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  if (args.resume) {
    console.log(`Resuming from progress: ${progress.completed.length} already completed`);
  }

  // Filter out already completed
  const pending = specs.filter((s) => !progress.completed.includes(s.filename));
  console.log(`Pending: ${pending.length} images\n`);

  if (pending.length === 0) {
    console.log('All images already generated!');
    return;
  }

  // Start generation
  const startTime = Date.now();
  const { success, failed } = await processBatch(pending, progress, args.dryRun, args.concurrency);
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n=== Generation Complete ===');
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Time: ${elapsed} minutes`);
  console.log(`Output: ${OUTPUT_DIR}`);

  if (failed > 0) {
    console.log('\nFailed images:');
    for (const f of progress.failed) {
      console.log(`  - ${f}`);
    }
    console.log('\nRun with --resume to retry failed images.');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
