/**
 * Companions API
 * CRUD operations for AI companions.
 */

import { get, post, patch, del } from './client';

/**
 * Physical appearance for companion image generation
 */
export interface CompanionAppearance {
  ethnicity: 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
  bodyType: 'slim' | 'athletic' | 'curvy' | 'plus-size';
  hairColor: 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
  breastSize?: number; // 0-100
}

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
