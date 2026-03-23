/**
 * Regenerate All Companions with Random Characteristics
 *
 * This script regenerates all companions on the platform with fresh
 * random identities and new anchor images using the improved iPhone-style
 * image generation pipeline.
 *
 * Flow for each companion:
 * 1. Generate random identity via API (occupation, vibe, distinctive features, etc.)
 * 2. Update companion spec with new identity/appearance/personality
 * 3. Generate new backstory via API
 * 4. Regenerate anchor images with backstory context
 *
 * Prerequisites:
 * - Gateway must be running and accessible
 * - Orchestrator must be running (for identity/backstory generation)
 * - FAL_API_KEY must be set (for image generation)
 * - JWT_SECRET must be available to mint admin tokens
 *
 * Usage:
 *   # Against local dev
 *   npx tsx scripts/regen-all-companions.ts
 *
 *   # Against production (run on EC2 or with tunnel)
 *   GATEWAY_URL=http://localhost:3001 JWT_SECRET=<secret> npx tsx scripts/regen-all-companions.ts
 *
 *   # Dry run (preview what would happen)
 *   npx tsx scripts/regen-all-companions.ts --dry-run
 *
 *   # Only regen specific companion
 *   npx tsx scripts/regen-all-companions.ts --companion-id=<uuid>
 *
 *   # Limit how many to process
 *   npx tsx scripts/regen-all-companions.ts --limit=5
 */

import * as crypto from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3002';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

// Delay between companions to avoid overwhelming the orchestrator/FAL
const DELAY_BETWEEN_COMPANIONS_MS = 20000;

// ============================================================================
// JWT Helper (minimal, no dependencies)
// ============================================================================

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
    exp: now + 3600, // 1 hour
    iss: 'campfire',
    aud: 'campfire-api',
  }));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ============================================================================
// API Helpers
// ============================================================================

async function apiGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path: string, body: any, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPatch(path: string, body: any, token: string): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ============================================================================
// Core Logic
// ============================================================================

interface CompanionSummary {
  id: string;
  name: string;
  ownerEmail: string;
  status: string;
  userId?: string;
}

async function listAllCompanions(token: string): Promise<CompanionSummary[]> {
  const all: CompanionSummary[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await apiGet(`/admin/companions?limit=${limit}&offset=${offset}&sortBy=createdAt`, token);
    const companions = data.data?.companions || data.companions || [];
    if (companions.length === 0) break;
    all.push(...companions);
    if (companions.length < limit) break;
    offset += limit;
  }

  return all;
}

async function getCompanionDetails(companionId: string, token: string): Promise<any> {
  const data = await apiGet(`/admin/companions/${companionId}`, token);
  return data.data || data;
}

async function generateRandomIdentity(): Promise<any> {
  // This endpoint is public, no auth needed
  const data = await apiPost('/companions/generate-identity', {});
  return data.data || data;
}

async function updateCompanionSpec(
  companionId: string,
  ownerUserId: string,
  identity: any,
  token: string
): Promise<void> {
  // We need to use the companion owner's token for PATCH
  // Mint a token as the owner
  const ownerToken = mintAdminToken(ownerUserId);

  // Map the generated identity to a spec update
  const appearance: any = {
    gender: identity.appearance?.gender || 'female',
    ethnicity: identity.appearance?.ethnicity || 'mixed',
    bodyType: identity.appearance?.body_type || 'athletic',
    hairColor: identity.appearance?.hair_color || 'brown',
  };

  if (appearance.gender === 'female') {
    // Convert 0-100 to S/M/L
    const bs = identity.appearance?.breast_size ?? 50;
    appearance.breastSize = bs <= 33 ? 'S' : bs <= 66 ? 'M' : 'L';
  } else {
    appearance.build = identity.appearance?.build || 'M';
  }

  await apiPatch(`/companions/${companionId}`, {
    name: identity.name,
    spec: {
      identity: {
        name: identity.name,
        pronouns: identity.pronouns || 'she/her',
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
    },
  }, ownerToken);
}

async function generateBackstory(
  companionId: string,
  identity: any,
  token: string
): Promise<any> {
  try {
    const data = await apiPost(`/companions/${companionId}/generate-backstory`, {
      archetype: identity.archetype,
      secondaryArchetype: identity.secondary_archetype,
      personality: identity.personality || {},
      tenets: [],
      userBackstoryHint: identity.backstory || null,
    }, token);
    return data.data || data;
  } catch (error) {
    console.warn(`  Warning: Backstory generation failed: ${error}`);
    return null;
  }
}

async function regenerateAnchors(
  companionId: string,
  identity: any,
  token: string
): Promise<any> {
  const appearance = {
    gender: identity.appearance?.gender || 'female',
    ethnicity: identity.appearance?.ethnicity || 'mixed',
    bodyType: identity.appearance?.body_type || 'athletic',
    hairColor: identity.appearance?.hair_color || 'brown',
    breastSize: identity.appearance?.gender === 'female'
      ? (identity.appearance?.breast_size <= 33 ? 'S' : identity.appearance?.breast_size <= 66 ? 'M' : 'L')
      : undefined,
    build: identity.appearance?.gender === 'male'
      ? (identity.appearance?.build || 'M')
      : undefined,
  };

  try {
    const data = await apiPost('/imagegen/generate-anchors', {
      companionId,
      appearance,
      style: identity.visual_style || 'realistic',
      personality: identity.personality || {},
    }, token);
    return data.data || data;
  } catch (error) {
    console.warn(`  Warning: Anchor generation failed: ${error}`);
    return null;
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
    companionId: args.find(a => a.startsWith('--companion-id='))?.split('=')[1],
    limit: parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '999', 10),
    skipImages: args.includes('--skip-images'),
    skipBackstory: args.includes('--skip-backstory'),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
Companion Regeneration Script
==============================

Regenerates all companions with fresh random identities and new anchor images.

Options:
  --dry-run           Preview what would happen
  --companion-id=ID   Only regen a specific companion
  --limit=N           Process at most N companions
  --skip-images       Skip anchor image regeneration
  --skip-backstory    Skip backstory generation
  --help              Show this help

Environment:
  GATEWAY_URL         Gateway base URL (default: http://localhost:3002)
  JWT_SECRET          JWT signing secret (required for admin auth)
`);
    process.exit(0);
  }

  console.log('\n=== Companion Regeneration ===');
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Mint an admin token (using a placeholder admin userId - the admin routes check role, not specific userId)
  const adminToken = mintAdminToken('00000000-0000-0000-0000-000000000001');

  // Test connectivity
  try {
    await apiGet('/admin/companions?limit=1', adminToken);
    console.log('Gateway connectivity: OK');
  } catch (error) {
    console.error(`Gateway connectivity failed: ${error}`);
    console.error('Make sure the gateway is running and JWT_SECRET is correct.');
    process.exit(1);
  }

  // List companions
  let companions: CompanionSummary[];
  if (args.companionId) {
    const detail = await getCompanionDetails(args.companionId, adminToken);
    companions = [{ id: args.companionId, name: detail.name, ownerEmail: detail.ownerEmail || '', status: detail.status, userId: detail.userId || detail.user_id }];
  } else {
    companions = await listAllCompanions(adminToken);
  }

  console.log(`Found ${companions.length} companions`);

  // Apply limit
  const toProcess = companions.slice(0, args.limit);
  console.log(`Processing: ${toProcess.length}`);
  console.log('');

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const companion = toProcess[i]!;
    console.log(`[${i + 1}/${toProcess.length}] ${companion.name} (${companion.id})`);

    if (args.dryRun) {
      console.log('  [DRY RUN] Would generate random identity');
      console.log('  [DRY RUN] Would update companion spec');
      console.log('  [DRY RUN] Would generate backstory');
      console.log('  [DRY RUN] Would regenerate anchor images');
      console.log('');
      success++;
      continue;
    }

    try {
      // Get companion details for userId
      let userId = companion.userId;
      if (!userId) {
        const detail = await getCompanionDetails(companion.id, adminToken);
        userId = detail.userId || detail.user_id || detail.ownerId;
      }

      if (!userId) {
        console.error('  ERROR: Could not determine companion owner userId');
        failed++;
        continue;
      }

      // 1. Generate random identity
      console.log('  Generating random identity...');
      const identity = await generateRandomIdentity();
      console.log(`  -> ${identity.name} (${identity.occupation || 'unknown occupation'}, ${identity.vibe || 'unknown vibe'})`);

      // 2. Update companion spec
      console.log('  Updating companion spec...');
      const ownerToken = mintAdminToken(userId);
      await updateCompanionSpec(companion.id, userId, identity, ownerToken);
      console.log('  -> Spec updated');

      // 3. Generate backstory
      if (!args.skipBackstory) {
        console.log('  Generating backstory...');
        const backstory = await generateBackstory(companion.id, identity, ownerToken);
        if (backstory) {
          console.log(`  -> Backstory: ${(backstory.backstory || '').substring(0, 80)}...`);
        }
      }

      // 4. Regenerate anchors
      if (!args.skipImages) {
        console.log('  Regenerating anchor images...');
        const anchors = await regenerateAnchors(companion.id, identity, ownerToken);
        if (anchors) {
          const count = anchors.anchors?.length || 0;
          console.log(`  -> ${count} anchor images generated`);
        }
      }

      success++;
      console.log('  Done!');
    } catch (error) {
      console.error(`  FAILED: ${error}`);
      failed++;
    }

    console.log('');

    // Delay between companions
    if (i < toProcess.length - 1 && !args.dryRun) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_COMPANIONS_MS));
    }
  }

  console.log('=== Complete ===');
  console.log(`Success: ${success}, Failed: ${failed}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
