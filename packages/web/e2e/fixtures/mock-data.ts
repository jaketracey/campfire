/**
 * Mock data for E2E tests
 * These fixtures represent deterministic data for testing the onboarding flow.
 */

import type { FemaleAppearance, MaleAppearance } from '@/lib/api/companions';

// ============================================================================
// Identity Generation Fixtures
// ============================================================================

export const mockFemaleIdentity = {
  name: 'Luna',
  pronouns: 'she/her',
  backstory: 'A digital artist from the neon-lit streets of Neo Tokyo',
  archetype: 'creator',
  secondary_archetype: 'explorer',
  personality: {
    warmth: 70,
    energy: 60,
    playfulness: 65,
    formality: 30,
    assertiveness: 55,
    curiosity: 80,
    empathy: 75,
    spontaneity: 70,
    optimism: 65,
    directness: 50,
  },
  appearance: {
    gender: 'female' as const,
    ethnicity: 'east-asian' as const,
    body_type: 'athletic',
    hair_color: 'fantasy',
    breast_size: 50, // M
  },
  visual_style: 'realistic',
  voice_gender: 'feminine',
  latency_ms: 1234,
};

export const mockMaleIdentity = {
  name: 'Marcus',
  pronouns: 'he/him',
  backstory: 'A former starship captain turned wandering philosopher',
  archetype: 'sage',
  secondary_archetype: 'hero',
  personality: {
    warmth: 55,
    energy: 45,
    playfulness: 35,
    formality: 60,
    assertiveness: 70,
    curiosity: 65,
    empathy: 60,
    spontaneity: 40,
    optimism: 55,
    directness: 75,
  },
  appearance: {
    gender: 'male' as const,
    ethnicity: 'caucasian' as const,
    body_type: 'athletic',
    hair_color: 'brown',
    build: 'M',
  },
  visual_style: 'realistic',
  voice_gender: 'masculine',
  latency_ms: 987,
};

// ============================================================================
// Appearance Fixtures (Type-safe)
// ============================================================================

export const mockFemaleAppearance: FemaleAppearance = {
  gender: 'female',
  ethnicity: 'east-asian',
  bodyType: 'athletic',
  hairColor: 'fantasy',
  breastSize: 'M',
};

export const mockMaleAppearance: MaleAppearance = {
  gender: 'male',
  ethnicity: 'caucasian',
  bodyType: 'athletic',
  hairColor: 'brown',
  build: 'M',
};

export const mockModifiedMaleAppearance: MaleAppearance = {
  gender: 'male',
  ethnicity: 'black',
  bodyType: 'muscular',
  hairColor: 'black',
  build: 'L',
};

// ============================================================================
// Companion Creation Response
// ============================================================================

export const mockCompanionResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 'cmp_test123',
  name: 'Luna',
  description: null,
  personality: '{}',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  avatarUrl: null,
  isPublic: false,
  isActive: true,
  status: 'active',
  createdAt: new Date().toISOString(),
  ownerId: 'user_test123',
  spec: {
    identity: {
      name: 'Luna',
      pronouns: 'she/her',
    },
    personality: {
      archetype: 'creator',
      traits: {
        warmth: 0.7,
        playfulness: 0.65,
      },
    },
    visual_style: {
      appearance: mockFemaleAppearance,
    },
  },
  specVersion: 1,
  ...overrides,
});

// ============================================================================
// Anchor Image Fixtures
// ============================================================================

export const mockAnchorImages = [
  {
    id: 'anchor_1',
    url: 'https://example.com/test-anchor-1.jpg',
    emotionalState: 'neutral',
    isIdentityAnchor: true,
  },
  {
    id: 'anchor_2',
    url: 'https://example.com/test-anchor-2.jpg',
    emotionalState: 'happy',
    isIdentityAnchor: false,
  },
  {
    id: 'anchor_3',
    url: 'https://example.com/test-anchor-3.jpg',
    emotionalState: 'flirty',
    isIdentityAnchor: false,
  },
];

// ============================================================================
// Backstory Generation Response
// ============================================================================

export const mockBackstoryResponse = {
  success: true,
  data: {
    backstory: 'Luna was born in the sprawling megacity of Neo Tokyo...',
    motivations: ['Creative expression', 'Human connection'],
    keyMemories: ['First digital art exhibition'],
    personalityQuirks: ['Talks to her digital brush'],
    latencyMs: 2500,
  },
};

// ============================================================================
// Session Creation Response
// ============================================================================

export const mockSessionResponse = (companionId: string) => ({
  id: 'ses_test123',
  companionId,
  title: 'Chat with Luna',
  status: 'active',
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
});
