/**
 * Companions API
 * CRUD operations for AI companions.
 */

import { get, post, patch, del } from './client';

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
