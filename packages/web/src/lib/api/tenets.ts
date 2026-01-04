/**
 * Tenets API
 * CRUD operations for behavioral tenets (rules governing companion behavior).
 */

import { get, post, patch, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type TenetCategory =
  | 'communication'
  | 'boundaries'
  | 'engagement'
  | 'emotional'
  | 'knowledge'
  | 'autonomy';

export type TenetPriority = 'core' | 'situational';

export interface Tenet {
  id: string;
  companionId: string;
  userId: string;
  category: TenetCategory;
  priority: TenetPriority;
  rule: string;
  description: string | null;
  isNegation: boolean;
  triggerContexts: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenetListResponse {
  tenets: Tenet[];
  counts: {
    core: number;
    situational: number;
  };
}

export interface CreateTenetInput {
  category: TenetCategory;
  priority: TenetPriority;
  rule: string;
  description?: string;
  isNegation?: boolean;
  triggerContexts?: string[];
}

export interface UpdateTenetInput {
  category?: TenetCategory;
  priority?: TenetPriority;
  rule?: string;
  description?: string;
  isNegation?: boolean;
  triggerContexts?: string[];
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * List all tenets for a companion
 */
export function listTenets(companionId: string): Promise<TenetListResponse> {
  return get<TenetListResponse>(`/companions/${companionId}/tenets`);
}

/**
 * Create a new tenet
 */
export function createTenet(
  companionId: string,
  input: CreateTenetInput
): Promise<Tenet> {
  return post<Tenet>(`/companions/${companionId}/tenets`, input);
}

/**
 * Update a tenet
 */
export function updateTenet(
  companionId: string,
  tenetId: string,
  input: UpdateTenetInput
): Promise<Tenet> {
  return patch<Tenet>(`/companions/${companionId}/tenets/${tenetId}`, input);
}

/**
 * Update tenet priority
 */
export function updateTenetPriority(
  companionId: string,
  tenetId: string,
  priority: TenetPriority
): Promise<Tenet> {
  return patch<Tenet>(`/companions/${companionId}/tenets/${tenetId}/priority`, {
    priority,
  });
}

/**
 * Delete a tenet
 */
export function deleteTenet(
  companionId: string,
  tenetId: string
): Promise<void> {
  return del<void>(`/companions/${companionId}/tenets/${tenetId}`);
}
