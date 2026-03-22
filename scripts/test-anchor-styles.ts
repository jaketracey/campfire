/**
 * Test Anchor Image Styles
 *
 * Experiments with different prompt strategies to generate more distinctive,
 * character-ful anchor images instead of the current "too beautiful and normal" look.
 *
 * Tests several prompt strategies side-by-side:
 * 1. "current" - Current production style (beautiful/handsome baseline)
 * 2. "character" - Adds distinctive features, imperfections, personality
 * 3. "cinematic" - Film still aesthetic, dramatic lighting, more editorial
 * 4. "candid" - Street photography / documentary style, less polished
 * 5. "editorial" - Fashion editorial with edge, high contrast, attitude
 *
 * Generates a grid of images for easy comparison.
 *
 * Usage:
 *   npx tsx scripts/test-anchor-styles.ts                          # Run all styles, 1 spec
 *   npx tsx scripts/test-anchor-styles.ts --styles=character,candid # Specific styles
 *   npx tsx scripts/test-anchor-styles.ts --specs=3                # Multiple specs
 *   npx tsx scripts/test-anchor-styles.ts --model=seedream-v4      # Use Seedream v4
 *   npx tsx scripts/test-anchor-styles.ts --model=flux-pro         # Use Flux Pro 1.1
 *   npx tsx scripts/test-anchor-styles.ts --dry-run                # Preview prompts only
 *
 * Environment:
 *   FAL_API_KEY    Required (unless --dry-run)
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

const MODELS: Record<string, string> = {
  'seedream-v4.5': 'fal-ai/bytedance/seedream/v4.5/text-to-image',
  'seedream-v4': 'fal-ai/bytedance/seedream/v4/text-to-image',
  'flux-2-pro': 'fal-ai/flux-2-pro',
  'recraft-v3': 'fal-ai/recraft/v3/text-to-image',
  'nano-banana-2': 'fal-ai/nano-banana-2',
};

const DEFAULT_MODEL = 'seedream-v4';
const IMAGE_WIDTH = 768;
const IMAGE_HEIGHT = 1024;
const OUTPUT_DIR = path.join(__dirname, '..', 'test-anchor-output');

// ============================================================================
// Types
// ============================================================================

type Gender = 'female' | 'male';
type Ethnicity = 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
type BodyType = 'slim' | 'athletic' | 'curvy' | 'plus-size' | 'muscular' | 'dad-bod';
type HairColor = 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
type StyleName = 'current' | 'character' | 'cinematic' | 'candid' | 'editorial';

interface CompanionSpec {
  gender: Gender;
  ethnicity: Ethnicity;
  bodyType: BodyType;
  hairColor: HairColor;
  label: string; // human-readable label for output
}

// ============================================================================
// Test Specs - diverse set to compare across
// ============================================================================

const TEST_SPECS: CompanionSpec[] = [
  { gender: 'female', ethnicity: 'east-asian', bodyType: 'slim', hairColor: 'black', label: 'f-east-asian-slim' },
  { gender: 'male', ethnicity: 'black', bodyType: 'athletic', hairColor: 'black', label: 'm-black-athletic' },
  { gender: 'female', ethnicity: 'caucasian', bodyType: 'curvy', hairColor: 'red', label: 'f-caucasian-curvy' },
  { gender: 'male', ethnicity: 'latina', bodyType: 'dad-bod', hairColor: 'brown', label: 'm-latino-dadbod' },
  { gender: 'female', ethnicity: 'middle-eastern', bodyType: 'athletic', hairColor: 'brown', label: 'f-mideast-athletic' },
  { gender: 'female', ethnicity: 'mixed', bodyType: 'slim', hairColor: 'fantasy', label: 'f-mixed-fantasy' },
  { gender: 'male', ethnicity: 'south-asian', bodyType: 'muscular', hairColor: 'black', label: 'm-south-asian-muscular' },
  { gender: 'female', ethnicity: 'black', bodyType: 'plus-size', hairColor: 'blonde', label: 'f-black-plussize' },
  { gender: 'male', ethnicity: 'caucasian', bodyType: 'slim', hairColor: 'blonde', label: 'm-caucasian-slim' },
  { gender: 'female', ethnicity: 'latina', bodyType: 'athletic', hairColor: 'brown', label: 'f-latina-athletic' },
  { gender: 'male', ethnicity: 'east-asian', bodyType: 'muscular', hairColor: 'black', label: 'm-east-asian-muscular' },
  { gender: 'female', ethnicity: 'south-asian', bodyType: 'curvy', hairColor: 'black', label: 'f-south-asian-curvy' },
  { gender: 'male', ethnicity: 'middle-eastern', bodyType: 'athletic', hairColor: 'brown', label: 'm-mideast-athletic' },
  { gender: 'male', ethnicity: 'mixed', bodyType: 'dad-bod', hairColor: 'brown', label: 'm-mixed-dadbod' },
];

// ============================================================================
// Distinctive features pool - randomly assigned to add character
// ============================================================================

const DISTINCTIVE_FEATURES = {
  female: [
    'light freckles across nose and cheeks',
    'a small beauty mark near her lip',
    'slightly crooked smile that gives her character',
    'laugh lines around her eyes showing genuine warmth',
    'a gap between her front teeth',
    'thick expressive eyebrows',
    'a small scar on her chin',
    'asymmetrical dimples',
    'sun-kissed skin with tan lines',
    'slightly upturned nose',
    'deep-set eyes with an intense gaze',
    'messy hair that falls naturally',
  ],
  male: [
    'light stubble and a weathered look',
    'a small scar through one eyebrow',
    'crooked nose that adds character',
    'laugh lines and crow\'s feet showing personality',
    'a gap between his front teeth',
    'thick bushy eyebrows',
    'slightly asymmetrical jaw',
    'salt-and-pepper stubble',
    'sun-weathered skin from time outdoors',
    'deep-set eyes with an intense gaze',
    'messy unkempt hair',
    'a prominent adam\'s apple and angular face',
  ],
};

// Personality-driven descriptors that replace "beautiful/handsome"
const PERSONALITY_OPENERS = {
  female: [
    'Striking woman',
    'Woman with a magnetic presence',
    'Confident woman',
    'Intriguing woman',
    'Woman with an unforgettable face',
    'Sharp-featured woman',
    'Woman with quiet intensity',
    'Approachable woman with an easy smile',
  ],
  male: [
    'Striking man',
    'Man with a magnetic presence',
    'Confident man',
    'Intriguing man',
    'Man with an unforgettable face',
    'Rugged man',
    'Man with quiet intensity',
    'Approachable man with an easy smile',
  ],
};

// ============================================================================
// Ethnicity descriptions (shared across styles)
// ============================================================================

const ETHNICITY_DESC: Record<Ethnicity, { female: string; male: string }> = {
  'east-asian': { female: 'East Asian', male: 'East Asian' },
  'south-asian': { female: 'South Asian', male: 'South Asian' },
  'black': { female: 'Black', male: 'Black' },
  'caucasian': { female: 'Caucasian', male: 'Caucasian' },
  'latina': { female: 'Latina', male: 'Latino' },
  'middle-eastern': { female: 'Middle Eastern', male: 'Middle Eastern' },
  'mixed': { female: 'mixed-race', male: 'mixed-race' },
};

const BODY_DESC: Record<BodyType, string> = {
  'slim': 'slim build',
  'athletic': 'athletic build',
  'curvy': 'curvy figure',
  'plus-size': 'full figure',
  'muscular': 'muscular build',
  'dad-bod': 'average build',
};

const HAIR_DESC: Record<HairColor, string> = {
  'black': 'black hair',
  'brown': 'brown hair',
  'blonde': 'blonde hair',
  'red': 'red hair',
  'fantasy': 'pastel-colored hair',
};

// ============================================================================
// Deterministic random from spec
// ============================================================================

function hashSpec(spec: CompanionSpec, salt: string = ''): number {
  const str = `${spec.gender}-${spec.ethnicity}-${spec.bodyType}-${spec.hairColor}-${salt}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function pick<T>(arr: T[], spec: CompanionSpec, salt: string = ''): T {
  return arr[hashSpec(spec, salt) % arr.length]!;
}

// ============================================================================
// Prompt Strategies
// ============================================================================

const STYLE_BUILDERS: Record<StyleName, (spec: CompanionSpec) => { prompt: string; negative: string }> = {

  /**
   * CURRENT - Matches existing production prompts.
   * "Beautiful/Handsome", flawless, 8K, photorealistic.
   */
  current: (spec) => {
    const eth = ETHNICITY_DESC[spec.ethnicity][spec.gender];
    const body = BODY_DESC[spec.bodyType];
    const hair = HAIR_DESC[spec.hairColor];
    const opener = spec.gender === 'female' ? 'Beautiful woman' : 'Handsome man';

    const prompt = [
      `${opener}, ${eth}, ${body}, ${hair}.`,
      `Portrait photography, natural expression, soft diffused lighting, shallow depth of field, shot on 85mm lens.`,
      `Warm genuine smile, confident and approachable, looking at camera with friendly eyes.`,
      `8K resolution, photorealistic, flawless skin, naturally beautiful.`,
      `Professional portrait photography, soft bokeh background.`,
    ].join(' ');

    const negative = 'ugly, deformed, disfigured, low quality, blurry, bad anatomy, extra limbs, watermark, text, cartoon, anime, 3d render, plastic skin';
    return { prompt, negative };
  },

  /**
   * CHARACTER - Adds distinctive features and imperfections.
   * Uses personality-driven openers instead of "beautiful/handsome".
   * Avoids "flawless" - embraces interesting faces.
   */
  character: (spec) => {
    const eth = ETHNICITY_DESC[spec.ethnicity][spec.gender];
    const body = BODY_DESC[spec.bodyType];
    const hair = HAIR_DESC[spec.hairColor];
    const opener = pick(PERSONALITY_OPENERS[spec.gender], spec, 'opener');
    const feature1 = pick(DISTINCTIVE_FEATURES[spec.gender], spec, 'feat1');
    const feature2 = pick(DISTINCTIVE_FEATURES[spec.gender], spec, 'feat2');

    const prompt = [
      `${opener}, ${eth}, ${body}, ${hair}.`,
      `${spec.gender === 'female' ? 'She' : 'He'} has ${feature1} and ${feature2}.`,
      `Relaxed natural expression, not posing - caught mid-thought or mid-conversation.`,
      `Portrait in natural light, imperfect and real.`,
      `Photorealistic, natural skin texture with pores and minor blemishes visible.`,
      `Shot on 50mm lens, shallow depth of field, muted warm tones.`,
    ].join(' ');

    // Note: we do NOT list "flawless" in our prompt, and we keep negative lighter
    const negative = 'deformed, disfigured, low quality, blurry, bad anatomy, extra limbs, watermark, text, cartoon, anime, 3d render';
    return { prompt, negative };
  },

  /**
   * CINEMATIC - Film still aesthetic.
   * Dramatic lighting, more editorial, like a movie character.
   */
  cinematic: (spec) => {
    const eth = ETHNICITY_DESC[spec.ethnicity][spec.gender];
    const body = BODY_DESC[spec.bodyType];
    const hair = HAIR_DESC[spec.hairColor];
    const feature = pick(DISTINCTIVE_FEATURES[spec.gender], spec, 'feat-cin');

    const lightingStyles = [
      'dramatic Rembrandt lighting with deep shadows',
      'moody chiaroscuro lighting, half the face in shadow',
      'warm golden backlight creating a halo effect',
      'cool blue-tinted window light from one side',
      'neon-lit urban night, colored light on face',
    ];
    const lighting = pick(lightingStyles, spec, 'light');

    const prompt = [
      `Cinematic film still. ${eth} ${spec.gender === 'female' ? 'woman' : 'man'}, ${body}, ${hair}.`,
      `${spec.gender === 'female' ? 'She' : 'He'} has ${feature}.`,
      `${lighting}.`,
      `Pensive expression, looking slightly off-camera, lost in thought.`,
      `Shot on anamorphic lens, film grain, color graded like a Villeneuve or Wong Kar-wai film.`,
      `Cinematic composition, atmospheric, emotionally evocative.`,
      `35mm film photography aesthetic, natural imperfections.`,
    ].join(' ');

    const negative = 'deformed, disfigured, blurry, bad anatomy, watermark, text, cartoon, anime, oversaturated, HDR, stock photo';
    return { prompt, negative };
  },

  /**
   * CANDID - Street photography / documentary style.
   * Less posed, more authentic, like catching someone in real life.
   */
  candid: (spec) => {
    const eth = ETHNICITY_DESC[spec.ethnicity][spec.gender];
    const body = BODY_DESC[spec.bodyType];
    const hair = HAIR_DESC[spec.hairColor];
    const feature = pick(DISTINCTIVE_FEATURES[spec.gender], spec, 'feat-can');

    const moments = [
      'caught mid-laugh, eyes crinkling with genuine amusement',
      'looking up from a book with a surprised half-smile',
      'squinting into the sun with a wry expression',
      'leaning against a wall, arms crossed, with an amused smirk',
      'running a hand through their hair, looking away thoughtfully',
      'caught in the middle of telling a story, animated and expressive',
    ];
    const moment = pick(moments, spec, 'moment');

    const prompt = [
      `Casual iPhone photo of a ${eth} ${spec.gender === 'female' ? 'woman' : 'man'}, ${body}, ${hair}.`,
      `${feature}.`,
      `${moment}.`,
      `Taken on an iPhone, natural lighting, no flash.`,
      `Slightly imperfect framing, not perfectly centered.`,
      `Real dating app photo feel, taken by a friend at a bar or restaurant.`,
      `Everything in focus, deep depth of field, no background blur, no bokeh.`,
      `Authentic, not retouched, natural skin, casual everyday clothing.`,
      `Smartphone camera quality, slight noise in low light, not overly sharp.`,
    ].join(' ');

    const negative = 'deformed, disfigured, blurry, bad anatomy, watermark, text, cartoon, anime, studio lighting, posed, glamorous, fashion photography, professional camera, DSLR, mirrorless, high fashion, editorial, shallow depth of field, bokeh, background blur, portrait mode';
    return { prompt, negative };
  },

  /**
   * EDITORIAL - Fashion editorial with edge.
   * High contrast, attitude, more stylized but still photographic.
   */
  editorial: (spec) => {
    const eth = ETHNICITY_DESC[spec.ethnicity][spec.gender];
    const body = BODY_DESC[spec.bodyType];
    const hair = HAIR_DESC[spec.hairColor];
    const feature = pick(DISTINCTIVE_FEATURES[spec.gender], spec, 'feat-ed');

    const moods = [
      'intense stare directly into camera, confrontational and magnetic',
      'looking over shoulder with an enigmatic expression',
      'chin tilted up slightly, powerful and self-assured',
      'soft eyes but firm jaw, vulnerability mixed with strength',
      'head slightly tilted, studying the viewer with curiosity',
    ];
    const mood = pick(moods, spec, 'mood');

    const prompt = [
      `Editorial portrait for a high-end magazine. ${eth} ${spec.gender === 'female' ? 'woman' : 'man'}, ${body}, ${hair}.`,
      `${feature}.`,
      `${mood}.`,
      `Minimal styling, raw and authentic. Skin texture visible, no heavy retouching.`,
      `High contrast black and white OR desaturated color palette.`,
      `Shot by Annie Leibovitz or Peter Lindbergh. Medium format film camera.`,
      `Powerful, editorial, unforgettable face.`,
    ].join(' ');

    const negative = 'deformed, disfigured, blurry, bad anatomy, watermark, text, cartoon, anime, oversaturated, cheap lighting, snapchat filter, beauty filter';
    return { prompt, negative };
  },
};

const ALL_STYLES: StyleName[] = ['current', 'character', 'cinematic', 'candid', 'editorial'];

// ============================================================================
// FAL API
// ============================================================================

async function pollForResult(statusUrl: string, responseUrl: string): Promise<any> {
  const maxWait = 180000;
  const pollInterval = 1500;
  let elapsed = 0;

  while (elapsed < maxWait) {
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });

    if (!statusResponse.ok) {
      throw new Error(`FAL status check failed: ${statusResponse.status} - ${await statusResponse.text()}`);
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

async function generateImage(
  prompt: string,
  negativePrompt: string,
  modelKey: string,
  guidanceScale?: number,
): Promise<string> {
  const modelId = MODELS[modelKey];
  if (!modelId) {
    throw new Error(`Unknown model: ${modelKey}. Available: ${Object.keys(MODELS).join(', ')}`);
  }

  const inputParams: Record<string, unknown> = {
    prompt,
    image_size: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
    num_images: 1,
    enable_safety_checker: false,
  };

  // Some models support negative_prompt
  if (modelKey.startsWith('seedream') || modelKey.startsWith('juggernaut') || modelKey === 'recraft-v3') {
    inputParams.negative_prompt = negativePrompt;
  }

  // Guidance scale (lower = more creative/diverse, higher = more prompt-adherent)
  if (guidanceScale !== undefined) {
    inputParams.guidance_scale = guidanceScale;
  }

  const response = await fetch(`${FAL_BASE_URL}/${modelId}`, {
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
    const finalResult = await pollForResult(result.status_url, result.response_url);
    imageUrl = finalResult.images?.[0]?.url;
  } else if (result.images?.[0]?.url) {
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
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, Buffer.from(buffer));
}

// ============================================================================
// HTML Report Generator
// ============================================================================

function generateHtmlReport(
  results: Array<{
    spec: CompanionSpec;
    style: StyleName;
    model: string;
    prompt: string;
    imagePath: string | null;
    error?: string;
  }>,
  modelKey: string
): string {
  const specLabels = [...new Set(results.map(r => r.spec.label))];
  // Use model as column if multiple models, otherwise use style
  const models = [...new Set(results.map(r => r.model))];
  const styles = [...new Set(results.map(r => r.style))];
  const columns = models.length > 1
    ? models.map(m => ({ key: m, label: m }))
    : styles.map(s => ({ key: s, label: s }));
  const columnField = models.length > 1 ? 'model' : 'style';

  let html = `<!DOCTYPE html>
<html>
<head>
  <title>Anchor Style Comparison - ${modelKey}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #1a1a1a; color: #eee; padding: 20px; }
    h1 { text-align: center; margin-bottom: 5px; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
    .grid { display: grid; grid-template-columns: 120px ${columns.map(() => '1fr').join(' ')}; gap: 8px; max-width: 1600px; margin: 0 auto; }
    .header { font-weight: bold; text-align: center; padding: 8px; background: #333; border-radius: 4px; font-size: 14px; }
    .spec-label { display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; background: #2a2a2a; border-radius: 4px; padding: 4px; text-align: center; }
    .cell { position: relative; }
    .cell img { width: 100%; border-radius: 4px; cursor: pointer; transition: transform 0.2s; }
    .cell img:hover { transform: scale(1.02); }
    .cell .error { background: #3a1a1a; border: 1px solid #5a2a2a; border-radius: 4px; padding: 20px; text-align: center; color: #f88; font-size: 12px; }
    .prompt-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); z-index: 100; padding: 40px; overflow: auto; cursor: pointer; }
    .prompt-overlay.active { display: flex; align-items: center; justify-content: center; flex-direction: column; }
    .prompt-overlay img { max-height: 70vh; max-width: 90vw; border-radius: 8px; }
    .prompt-overlay .prompt-text { max-width: 800px; margin-top: 20px; font-size: 14px; color: #ccc; line-height: 1.5; background: #222; padding: 16px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Anchor Style Comparison</h1>
  <p class="subtitle">Model: ${modelKey} | Generated: ${new Date().toISOString()}</p>

  <div class="grid">
    <div class="header">Spec</div>
    ${columns.map(c => `<div class="header">${c.label}</div>`).join('\n    ')}

    ${specLabels.map(label => {
      const specResults = results.filter(r => r.spec.label === label);
      return `<div class="spec-label">${label}</div>
    ${columns.map(col => {
        const r = specResults.find(sr => (sr as any)[columnField] === col.key);
        if (!r || !r.imagePath) {
          return `<div class="cell"><div class="error">${r?.error || 'Not generated'}</div></div>`;
        }
        const relPath = path.relative(OUTPUT_DIR, r.imagePath);
        const promptEscaped = r.prompt.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return `<div class="cell"><img src="${relPath}" title="${promptEscaped}" onclick="showPrompt(this, '${promptEscaped}')" /></div>`;
      }).join('\n    ')}`;
    }).join('\n    ')}
  </div>

  <div class="prompt-overlay" id="overlay" onclick="this.classList.remove('active')">
    <img id="overlay-img" src="" />
    <div class="prompt-text" id="overlay-prompt"></div>
  </div>

  <script>
    function showPrompt(img, prompt) {
      document.getElementById('overlay-img').src = img.src;
      document.getElementById('overlay-prompt').textContent = prompt;
      document.getElementById('overlay').classList.add('active');
    }
  </script>
</body>
</html>`;

  return html;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);

  const stylesArg = args.find(a => a.startsWith('--styles='))?.split('=')[1];
  const styles = stylesArg
    ? stylesArg.split(',').filter(s => ALL_STYLES.includes(s as StyleName)) as StyleName[]
    : ALL_STYLES;

  return {
    styles,
    specs: parseInt(args.find(a => a.startsWith('--specs='))?.split('=')[1] || '3', 10),
    model: args.find(a => a.startsWith('--model='))?.split('=')[1] || DEFAULT_MODEL,
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
    concurrent: parseInt(args.find(a => a.startsWith('--concurrent='))?.split('=')[1] || '2', 10),
    compareModels: args.includes('--compare-models'),
    // Guidance scale: comma-separated list to test multiple values (lower=creative, higher=strict)
    guidanceScales: (args.find(a => a.startsWith('--guidance='))?.split('=')[1] || '')
      .split(',').filter(Boolean).map(Number),
  };
}

function printUsage(): void {
  console.log(`
Anchor Style Tester
===================

Generates anchor images with different prompt strategies to find styles
that produce more distinctive, character-ful results.

Styles:
  current    - Production baseline (beautiful/handsome, flawless skin)
  character  - Distinctive features, imperfections, personality-driven
  cinematic  - Film still aesthetic, dramatic lighting, editorial
  candid     - Street photography, unposed, authentic moments
  editorial  - High-end magazine, raw, powerful faces

Options:
  --styles=a,b,c     Comma-separated styles to test (default: all)
  --specs=N           Number of companion specs to test (default: 3, max: ${TEST_SPECS.length})
  --model=<model>     FAL model to use (default: ${DEFAULT_MODEL})
                      Available: ${Object.keys(MODELS).join(', ')}
  --concurrent=N      Concurrent FAL requests (default: 2)
  --dry-run           Preview prompts without generating images
  --help              Show this help

Examples:
  npx tsx scripts/test-anchor-styles.ts                             # All styles, 3 specs
  npx tsx scripts/test-anchor-styles.ts --styles=character,candid   # Just 2 styles
  npx tsx scripts/test-anchor-styles.ts --specs=6 --model=flux-pro  # More specs, different model
  npx tsx scripts/test-anchor-styles.ts --dry-run                   # Preview prompts

Environment:
  FAL_API_KEY    Required (unless --dry-run)

Output:
  test-anchor-output/
    comparison.html    - Side-by-side visual comparison
    {spec}/{style}.png - Individual images
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!FAL_API_KEY && !args.dryRun) {
    console.error('Error: FAL_API_KEY environment variable not set');
    console.error('Usage: FAL_API_KEY=your-key npx tsx scripts/test-anchor-styles.ts');
    process.exit(1);
  }

  const specs = TEST_SPECS.slice(0, Math.min(args.specs, TEST_SPECS.length));

  // --compare-models mode: run one style across all models
  const modelsToRun = args.compareModels ? Object.keys(MODELS) : [args.model];
  const style = args.styles[0]!; // Use first style for compare-models

  if (args.compareModels) {
    console.log('\n=== Model Comparison Mode ===');
    console.log(`Style: ${style}`);
    console.log(`Models: ${modelsToRun.join(', ')}`);
  } else {
    console.log('\n=== Anchor Style Tester ===');
    console.log(`Model: ${args.model} (${MODELS[args.model] || 'unknown'})`);
    console.log(`Styles: ${args.styles.join(', ')}`);
  }
  console.log(`Specs: ${specs.length} (${specs.map(s => s.label).join(', ')})`);
  const gsCount = args.guidanceScales.length > 0 ? args.guidanceScales.length : 1;
  const totalImages = args.compareModels
    ? specs.length * modelsToRun.length * gsCount
    : specs.length * args.styles.length * gsCount;
  console.log(`Total images: ${totalImages}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (args.dryRun) console.log('Mode: DRY RUN');
  console.log('');

  // Guidance scales to test (empty = use model default)
  const guidanceScales = args.guidanceScales.length > 0 ? args.guidanceScales : [undefined];
  if (args.guidanceScales.length > 0) {
    console.log(`Guidance scales: ${args.guidanceScales.join(', ')}`);
  }

  // Build all generation tasks
  const tasks: Array<{
    spec: CompanionSpec;
    style: StyleName;
    model: string;
    prompt: string;
    negative: string;
    outputPath: string;
    guidanceScale?: number;
  }> = [];

  if (args.compareModels) {
    // One style, all models, optionally multiple guidance scales
    for (const spec of specs) {
      const { prompt, negative } = STYLE_BUILDERS[style](spec);
      for (const modelKey of modelsToRun) {
        for (const gs of guidanceScales) {
          const gsSuffix = gs !== undefined ? `-gs${gs}` : '';
          const outputPath = path.join(OUTPUT_DIR, spec.label, `${style}-${modelKey}${gsSuffix}.png`);
          tasks.push({ spec, style, model: modelKey, prompt, negative, outputPath, guidanceScale: gs });
        }
      }
    }
  } else {
    // One model, selected styles
    for (const spec of specs) {
      for (const s of args.styles) {
        const { prompt, negative } = STYLE_BUILDERS[s](spec);
        for (const gs of guidanceScales) {
          const gsSuffix = gs !== undefined ? `-gs${gs}` : '';
          const outputPath = path.join(OUTPUT_DIR, spec.label, `${s}-${args.model}${gsSuffix}.png`);
          tasks.push({ spec, style: s, model: args.model, prompt, negative, outputPath, guidanceScale: gs });
        }
      }
    }
  }

  if (args.dryRun) {
    for (const task of tasks) {
      console.log(`--- ${task.spec.label} / ${task.style} / ${task.model} ---`);
      console.log(`  Prompt: ${task.prompt}`);
      console.log('');
    }
    console.log(`\nWould generate ${tasks.length} images. Remove --dry-run to execute.`);
    return;
  }

  // Generate images
  const results: Array<{
    spec: CompanionSpec;
    style: StyleName;
    model: string;
    prompt: string;
    imagePath: string | null;
    error?: string;
  }> = [];

  const startTime = Date.now();
  let completed = 0;

  // Process in batches
  for (let i = 0; i < tasks.length; i += args.concurrent) {
    const batch = tasks.slice(i, i + args.concurrent);

    const batchResults = await Promise.all(
      batch.map(async (task) => {
        const gsLabel = task.guidanceScale !== undefined ? ` gs=${task.guidanceScale}` : '';
        const modelLabel = `${task.model}${gsLabel}`;
        console.log(`[${completed + 1}/${tasks.length}] ${task.spec.label} / ${task.style} / ${modelLabel}...`);

        try {
          const imageUrl = await generateImage(task.prompt, task.negative, task.model, task.guidanceScale);
          await downloadImage(imageUrl, task.outputPath);
          console.log(`  Saved: ${task.outputPath}`);

          return {
            spec: task.spec,
            style: task.style,
            model: modelLabel,
            prompt: task.prompt,
            imagePath: task.outputPath,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`  Failed: ${errorMsg}`);

          return {
            spec: task.spec,
            style: task.style,
            model: modelLabel,
            prompt: task.prompt,
            imagePath: null,
            error: errorMsg,
          };
        }
      })
    );

    results.push(...batchResults);
    completed += batch.length;

    // Small delay between batches
    if (i + args.concurrent < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Generate comparison HTML
  const reportLabel = args.compareModels ? `${style} across models` : args.model;
  const html = generateHtmlReport(results, reportLabel);
  const htmlPath = path.join(OUTPUT_DIR, args.compareModels ? 'model-comparison.html' : 'comparison.html');
  fs.writeFileSync(htmlPath, html);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter(r => r.imagePath).length;
  const failed = results.filter(r => !r.imagePath).length;

  console.log('\n=== Done ===');
  console.log(`Time: ${elapsed}s`);
  console.log(`Success: ${succeeded}, Failed: ${failed}`);
  console.log(`\nOpen the comparison:`);
  console.log(`  open ${htmlPath}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
