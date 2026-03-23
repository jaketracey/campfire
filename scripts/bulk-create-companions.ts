/**
 * Bulk Create Companions
 *
 * Generates N new companions end-to-end:
 * 1. Generate random identity via orchestrator
 * 2. Create companion in DB
 * 3. Activate companion
 * 4. Generate backstory
 * 5. Generate anchor images
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:3002 JWT_SECRET=<secret> npx tsx scripts/bulk-create-companions.ts --count=500
 *   GATEWAY_URL=http://localhost:3002 JWT_SECRET=<secret> npx tsx scripts/bulk-create-companions.ts --count=5 --dry-run
 */

import * as crypto from 'crypto';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3002';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';
// How many concurrent companion generations to run
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
// Delay between batches
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '5000', 10);

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function mintAdminToken(userId: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    userId,
    email: 'admin@ignite.cam',
    role: 'admin',
    iat: now,
    exp: now + 7200,
    iss: 'campfire',
    aud: 'campfire-api',
  }));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';

async function apiFetch(method: string, path: string, body?: any, token?: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text.substring(0, 200)}`);
  }

  return res.json();
}

interface CompanionResult {
  index: number;
  name: string;
  id?: string;
  identity?: boolean;
  created?: boolean;
  activated?: boolean;
  backstory?: boolean;
  anchors?: number;
  error?: string;
  durationMs: number;
}

async function createOneCompanion(index: number, total: number, token: string, dryRun: boolean): Promise<CompanionResult> {
  const start = Date.now();
  const result: CompanionResult = { index, name: '?', durationMs: 0 };

  try {
    // 1. Generate random identity
    const identity = await apiFetch('POST', '/api/v1/companions/generate-identity', {});
    result.name = identity.name;
    result.identity = true;

    if (dryRun) {
      console.log(`  [${index + 1}/${total}] DRY RUN: ${identity.name} (${identity.occupation}, ${identity.vibe})`);
      result.durationMs = Date.now() - start;
      return result;
    }

    console.log(`  [${index + 1}/${total}] Creating ${identity.name} (${identity.occupation || '?'}, ${identity.vibe || '?'})...`);

    // 2. Build appearance
    const appearance: any = {
      gender: identity.appearance?.gender || 'female',
      ethnicity: identity.appearance?.ethnicity || 'mixed',
      bodyType: identity.appearance?.body_type || 'athletic',
      hairColor: identity.appearance?.hair_color || 'brown',
    };
    if (appearance.gender === 'female') {
      const bs = identity.appearance?.breast_size ?? 50;
      appearance.breastSize = bs <= 33 ? 'S' : bs <= 66 ? 'M' : 'L';
    } else {
      appearance.build = identity.appearance?.build || 'M';
    }

    // 3. Create companion
    const spec = {
      identity: {
        name: identity.name,
        pronouns: identity.pronouns || 'she/her',
        backstory: identity.backstory || '',
        address_style: 'friendly',
      },
      personality: {
        archetype: identity.archetype || 'explorer',
        secondary_archetype: identity.secondary_archetype || null,
        traits: identity.personality || {},
      },
      visual_style: {
        style_type: identity.visual_style || 'realistic',
        appearance,
      },
      voice: {
        provider: 'elevenlabs',
      },
    };

    const created = await apiFetch('POST', '/api/v1/companions', {
      name: identity.name,
      personality: identity.archetype || 'explorer',
      isPublic: true,
      spec,
    }, token);

    const companionId = created.id;
    result.id = companionId;
    result.created = true;

    // 4. Activate
    await apiFetch('POST', `/api/v1/companions/${companionId}/activate`, {}, token);
    result.activated = true;

    // 5. Generate backstory
    try {
      await apiFetch('POST', `/api/v1/companions/${companionId}/generate-backstory`, {
        archetype: identity.archetype,
        secondaryArchetype: identity.secondary_archetype,
        personality: identity.personality || {},
        tenets: [],
        userBackstoryHint: identity.backstory || null,
      }, token);
      result.backstory = true;
    } catch (e) {
      console.warn(`    Backstory failed: ${e}`);
    }

    // 6. Generate anchor images
    try {
      const anchors = await apiFetch('POST', '/api/v1/imagegen/generate-anchors', {
        companionId,
        appearance,
        style: identity.visual_style || 'realistic',
        personality: identity.personality || {},
      }, token);
      result.anchors = anchors?.data?.anchors?.length || anchors?.anchors?.length || 0;
    } catch (e) {
      console.warn(`    Anchors failed: ${e}`);
    }

    console.log(`    ✓ ${identity.name} — backstory:${result.backstory ? 'yes' : 'no'} anchors:${result.anchors ?? 0}`);
  } catch (e: any) {
    result.error = e.message;
    console.error(`    ✗ [${index + 1}] ${result.name}: ${e.message}`);
  }

  result.durationMs = Date.now() - start;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '10', 10);
  const dryRun = args.includes('--dry-run');
  const concurrency = Math.min(CONCURRENCY, count);

  console.log(`\n=== Bulk Companion Creation ===`);
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`Count: ${count}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const token = mintAdminToken(ADMIN_USER_ID);

  // Test connectivity
  try {
    await apiFetch('GET', '/api/v1/companions?limit=1', undefined, token);
    console.log('Gateway: OK');
  } catch (e) {
    console.error(`Gateway failed: ${e}`);
    process.exit(1);
  }

  const results: CompanionResult[] = [];
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < count; i += concurrency) {
    const batchSize = Math.min(concurrency, count - i);
    const batch = Array.from({ length: batchSize }, (_, j) =>
      createOneCompanion(i + j, count, token, dryRun)
    );

    const batchResults = await Promise.all(batch);
    results.push(...batchResults);

    // Delay between batches (not after the last one)
    if (i + batchSize < count && !dryRun) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const totalMs = Date.now() - startTime;
  const succeeded = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;
  const withAnchors = results.filter(r => (r.anchors ?? 0) > 0).length;
  const withBackstory = results.filter(r => r.backstory).length;

  console.log(`\n=== Results ===`);
  console.log(`Total: ${count} | Success: ${succeeded} | Failed: ${failed}`);
  console.log(`Backstories: ${withBackstory} | With anchors: ${withAnchors}`);
  console.log(`Total time: ${(totalMs / 1000).toFixed(1)}s | Avg: ${(totalMs / count / 1000).toFixed(1)}s/companion`);

  if (failed > 0) {
    console.log(`\nFailed:`);
    results.filter(r => r.error).forEach(r => {
      console.log(`  [${r.index + 1}] ${r.name}: ${r.error}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
