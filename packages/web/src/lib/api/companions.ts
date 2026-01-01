/**
 * Companions API
 * CRUD operations for AI companions.
 */

import { get, post, patch, del } from './client';

/**
 * Companion visual style from spec
 */
export interface CompanionVisualStyle {
  style_type?: string;
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
}

/**
 * Companion spec (personality, voice, visual, boundaries)
 */
export interface CompanionSpec {
  identity?: {
    name?: string;
    pronouns?: string;
    backstory?: string;
  };
  personality?: {
    archetype?: string;
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
