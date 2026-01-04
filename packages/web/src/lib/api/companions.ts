/**
 * Companions API
 * CRUD operations for AI companions.
 */

import { get, post, patch, del } from './client';

/**
 * Physical appearance for companion image generation
 */
export type AppearanceEthnicity = 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
export type FemaleBodyType = 'slim' | 'athletic' | 'curvy' | 'plus-size';
export type MaleBodyType = 'slim' | 'athletic' | 'muscular' | 'dad-bod';
export type AppearanceBodyType = FemaleBodyType | MaleBodyType;
export type AppearanceHairColor = 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
export type SizeCategory = 'S' | 'M' | 'L';

interface BaseAppearance {
  ethnicity: AppearanceEthnicity;
  hairColor: AppearanceHairColor;
}

export interface FemaleAppearance extends BaseAppearance {
  gender: 'female';
  bodyType: FemaleBodyType;
  breastSize: SizeCategory;
}

export interface MaleAppearance extends BaseAppearance {
  gender: 'male';
  bodyType: MaleBodyType;
  build: SizeCategory;
}

export type CompanionAppearance = FemaleAppearance | MaleAppearance;

/**
 * Companion visual style from spec
 */
export interface CompanionVisualStyle {
  style_type?: string;
  appearance?: CompanionAppearance;
  physical_attributes?: {
    apparent_age?: string;
    hair_color?: string;
    hair_style?: string;
    eye_color?: string;
    skin_tone?: string;
    build?: string;
    notable_features?: string[];
    clothing_style?: string;
    accessories?: string[];
  };
  style_modifiers?: string[];
  custom_style_description?: string;
  palette?: string[];
  constraints?: string[];
  reference_assets?: string[];
}

/**
 * Companion spec (personality, voice, visual, boundaries)
 */
export interface CompanionSpec {
  identity?: {
    name?: string;
    pronouns?: string;
    backstory?: string;
    address_style?: string;
  };
  personality?: {
    archetype?: string;
    secondary_archetype?: string;
    traits?: Record<string, number>;
  };
  voice?: {
    provider?: string;
    voice_id?: string;
  };
  visual_style?: CompanionVisualStyle;
  boundaries?: {
    content_rating?: string;
    relationship_pacing?: string;
    topics_avoid?: string[];
    safe_topics?: string[];
    emotional_depth?: 'surface' | 'moderate' | 'deep';
  };
  memory_consent?: {
    allow_long_term?: boolean;
    allow_kg_extraction?: boolean;
    retention_days?: number;
  };
}

export interface Companion {
  id: string;
  name: string;
  description: string | null;
  personality: string;
  voiceId: string | null;
  avatarUrl: string | null;
  allowedTools: string[];
  systemPrompt?: string;
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
  ownerId: string;
  spec?: CompanionSpec | null;
  specVersion?: number;
  /** The ID of the most recent active/paused session for this companion */
  latestSessionId?: string | null;
  /** When the latest session was last active */
  latestSessionUpdatedAt?: string | null;
  /** URL of the most recent image generated during conversations */
  latestConversationImageUrl?: string | null;
}

export interface CreateCompanionInput {
  name: string;
  description?: string;
  personality: string;
  voiceId?: string;
  avatarUrl?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  isPublic?: boolean;
  /** Full companion spec for detailed configuration */
  spec?: CompanionSpec;
}

export interface UpdateCompanionInput {
  name?: string;
  description?: string;
  personality?: string;
  voiceId?: string;
  avatarUrl?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  isPublic?: boolean;
  isActive?: boolean;
  spec?: {
    personality?: {
      traits?: Record<string, number>;
    };
  };
}

export interface CompanionListResponse {
  companions: Companion[];
  limit: number;
  offset: number;
}

/**
 * List companions for current user
 */
export function listCompanions(options?: {
  limit?: number;
  offset?: number;
  includePublic?: boolean;
}): Promise<CompanionListResponse> {
  return get<CompanionListResponse>('/companions', options);
}

/**
 * Get companion by ID
 */
export function getCompanion(companionId: string): Promise<Companion> {
  return get<Companion>(`/companions/${companionId}`);
}

/**
 * Create a new companion
 */
export function createCompanion(input: CreateCompanionInput): Promise<Companion> {
  return post<Companion>('/companions', input);
}

/**
 * Update a companion
 */
export function updateCompanion(
  companionId: string,
  input: UpdateCompanionInput
): Promise<Companion> {
  return patch<Companion>(`/companions/${companionId}`, input);
}

/**
 * Delete a companion
 */
export function deleteCompanion(companionId: string): Promise<void> {
  return del<void>(`/companions/${companionId}`);
}

/**
 * Clone a public companion
 */
export function cloneCompanion(companionId: string): Promise<Companion> {
  return post<Companion>(`/companions/${companionId}/clone`);
}

/**
 * Update companion personality traits
 */
export function updateCompanionPersonality(
  companionId: string,
  traits: Record<string, number>
): Promise<Companion> {
  return patch<Companion>(`/companions/${companionId}`, {
    spec: {
      personality: {
        traits,
      },
    },
  });
}

// Backstory generation types
export interface GenerateBackstoryRequest {
  archetype: string;
  secondaryArchetype?: string;
  archetypeDescription?: string;
  personality: {
    warmth: number;
    energy: number;
    playfulness: number;
    formality: number;
    assertiveness: number;
    curiosity: number;
    empathy: number;
    spontaneity: number;
    optimism: number;
    directness: number;
  };
  tenets?: Array<{
    category: string;
    priority: string;
    rule: string;
    isNegation: boolean;
  }>;
  userBackstoryHint?: string;
}

export interface GenerateBackstoryResult {
  backstory: string;
  motivations: string[];
  keyMemories: string[];
  personalityQuirks: string[];
  latencyMs: number;
}

/**
 * Generate a backstory for a companion using LLM
 * The backstory is automatically saved to the knowledge graph
 */
export async function generateBackstory(
  companionId: string,
  request: GenerateBackstoryRequest
): Promise<GenerateBackstoryResult> {
  const response = await post<{ success: boolean; data: GenerateBackstoryResult }>(
    `/companions/${companionId}/generate-backstory`,
    request
  );
  return response.data;
}

/**
 * Backstory data fetched from knowledge graph
 */
export interface CompanionBackstory {
  hasBackstory: boolean;
  backstory: string | null;
  motivations: string[];
  keyMemories: string[];
  personalityQuirks: string[];
}

/**
 * Fetch the generated backstory for a companion from the knowledge graph
 */
export async function getCompanionBackstory(
  companionId: string
): Promise<CompanionBackstory> {
  const response = await get<{ success: boolean; data: CompanionBackstory }>(
    `/companions/${companionId}/backstory`
  );
  return response.data;
}

/**
 * Generated personality traits for companion creation
 */
export interface GeneratedPersonality {
  warmth: number;
  energy: number;
  playfulness: number;
  formality: number;
  assertiveness: number;
  curiosity: number;
  empathy: number;
  spontaneity: number;
  optimism: number;
  directness: number;
}

/**
 * Generated appearance for companion creation (gender-aware)
 */
export interface GeneratedAppearance {
  gender: 'female' | 'male';
  ethnicity: 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
  bodyType: 'slim' | 'athletic' | 'curvy' | 'plus-size' | 'muscular' | 'dad-bod';
  hairColor: 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
  breastSize?: SizeCategory; // Female only
  build?: SizeCategory; // Male only
}

/**
 * Generated random identity for companion creation (full companion)
 */
export interface GeneratedIdentity {
  name: string;
  pronouns: string;
  backstory: string;
  archetype: string;
  secondaryArchetype: string | null;
  personality: GeneratedPersonality;
  appearance: GeneratedAppearance;
  visualStyle: 'realistic' | 'anime' | 'stylized' | 'abstract' | 'minimal';
  voiceGender: 'feminine' | 'masculine' | 'neutral';
  latencyMs: number;
}

/**
 * Generate a random companion identity using LLM
 */
export async function generateRandomIdentity(): Promise<GeneratedIdentity> {
  const response = await post<{
    name: string;
    pronouns: string;
    backstory: string;
    archetype: string;
    secondary_archetype: string | null;
    personality: {
      warmth: number;
      energy: number;
      playfulness: number;
      formality: number;
      assertiveness: number;
      curiosity: number;
      empathy: number;
      spontaneity: number;
      optimism: number;
      directness: number;
    };
    appearance: {
      gender?: 'female' | 'male';
      ethnicity: string;
      body_type: string;
      hair_color: string;
      breast_size?: number;
      build?: string;
    };
    visual_style: string;
    voice_gender: string;
    latency_ms: number;
  }>('/companions/generate-identity', {});

  // Determine gender from response or infer from voice gender
  const gender = response.appearance.gender ??
    (response.voice_gender === 'masculine' ? 'male' : 'female');

  // Convert size based on gender
  const sizeCategory = (value: number | undefined): SizeCategory => {
    if (!value) return 'M';
    if (value <= 33) return 'S';
    if (value <= 66) return 'M';
    return 'L';
  };

  return {
    name: response.name,
    pronouns: response.pronouns,
    backstory: response.backstory,
    archetype: response.archetype,
    secondaryArchetype: response.secondary_archetype,
    personality: response.personality,
    appearance: {
      gender,
      ethnicity: response.appearance.ethnicity as GeneratedAppearance['ethnicity'],
      bodyType: response.appearance.body_type as GeneratedAppearance['bodyType'],
      hairColor: response.appearance.hair_color as GeneratedAppearance['hairColor'],
      breastSize: gender === 'female' ? sizeCategory(response.appearance.breast_size) : undefined,
      build: gender === 'male' ? (response.appearance.build as SizeCategory || 'M') : undefined,
    },
    visualStyle: response.visual_style as GeneratedIdentity['visualStyle'],
    voiceGender: response.voice_gender as GeneratedIdentity['voiceGender'],
    latencyMs: response.latency_ms,
  };
}

// ============================================================================
// Companion Friends API
// ============================================================================

/**
 * Friend companion details
 */
export interface FriendCompanion {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  isPublic: boolean;
}

/**
 * Companion friendship record
 */
export interface CompanionFriendship {
  id: string;
  companionId: string;
  friendCompanionId: string;
  relationshipType: string | null;
  howTheyMet: string | null;
  nickname: string | null;
  familiarityLevel: number;
  createdAt: string;
  updatedAt: string;
  friendCompanion?: FriendCompanion;
}

/**
 * Friends list response
 */
export interface CompanionFriendsListResponse {
  friends: CompanionFriendship[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * List friends for a companion
 */
export async function listCompanionFriends(
  companionId: string,
  options?: {
    limit?: number;
    offset?: number;
    relationshipType?: string;
  }
): Promise<CompanionFriendsListResponse> {
  return get<CompanionFriendsListResponse>(
    `/companions/${companionId}/friends`,
    options
  );
}

/**
 * Input for adding a friend
 */
export interface AddFriendInput {
  friendCompanionId: string;
  relationshipType?: string;
  howTheyMet?: string;
  nickname?: string;
}

/**
 * Add a friend to a companion
 */
export async function addCompanionFriend(
  companionId: string,
  input: AddFriendInput
): Promise<CompanionFriendship> {
  return post<CompanionFriendship>(`/companions/${companionId}/friends`, input);
}

/**
 * Input for updating a friendship
 */
export interface UpdateFriendshipInput {
  relationshipType?: string;
  nickname?: string;
  familiarityLevel?: number;
}

/**
 * Update friendship metadata
 */
export async function updateCompanionFriendship(
  companionId: string,
  friendId: string,
  input: UpdateFriendshipInput
): Promise<CompanionFriendship> {
  return patch<CompanionFriendship>(
    `/companions/${companionId}/friends/${friendId}`,
    input
  );
}

/**
 * Remove a friend from a companion
 */
export async function removeCompanionFriend(
  companionId: string,
  friendId: string
): Promise<void> {
  return del<void>(`/companions/${companionId}/friends/${friendId}`);
}

/**
 * Check if two companions are friends
 */
export async function checkCompanionFriendship(
  companionId: string,
  friendId: string
): Promise<{ companionId: string; friendCompanionId: string; areFriends: boolean }> {
  return get<{ companionId: string; friendCompanionId: string; areFriends: boolean }>(
    `/companions/${companionId}/friends/${friendId}/check`
  );
}
