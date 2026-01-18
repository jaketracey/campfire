/**
 * Admin Companions API
 * Administrative operations for companion management.
 */

import { get } from './client';

// ============================================================================
// Types
// ============================================================================

export type CompanionStatus = 'draft' | 'active' | 'archived';

export interface AdminCompanion {
  id: string;
  name: string;
  status: CompanionStatus;
  createdAt: string;
  ownerId: string;
  ownerEmail: string;
  avatarUrl: string | null;
  sessionCount: number;
  totalMessages: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  imageCount: number;
  videoCount: number;
  entityCount: number;
}

export interface AdminCompanionDetail extends AdminCompanion {
  isPublic: boolean;
  specVersion: number;
  updatedAt: string;
  backstory: string | null;
  spec: {
    identity?: {
      name?: string;
      pronouns?: string;
      address_style?: string;
      backstory?: string;
    };
    personality?: {
      archetype?: string;
      secondary_archetype?: string;
      traits?: Record<string, number>;
    };
    [key: string]: unknown;
  };
}

export interface AdminCompanionImage {
  id: string;
  url: string;
  width: number;
  height: number;
  emotionalState: string;
  style: string;
  prompt: string | null;
  provider: string;
  createdAt: string;
}

export interface AdminKnowledgeGraphEntity {
  id: string;
  name: string;
  canonicalName: string;
  entityType: string;
  aliases: string[];
  metadata: Record<string, unknown>;
}

export interface AdminKnowledgeGraphEdge {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  confidence: number;
}

export interface AdminKnowledgeGraph {
  entities: AdminKnowledgeGraphEntity[];
  edges: AdminKnowledgeGraphEdge[];
}

export interface AdminCompanionListResponse {
  success: boolean;
  data: {
    companions: AdminCompanion[];
    hasMore: boolean;
    limit: number;
    offset: number;
  };
}

export interface AdminCompanionDetailResponse {
  success: boolean;
  data: AdminCompanionDetail;
}

export interface AdminCompanionImagesResponse {
  success: boolean;
  data: {
    images: AdminCompanionImage[];
    hasMore: boolean;
    limit: number;
    offset: number;
  };
}

export interface AdminKnowledgeGraphResponse {
  success: boolean;
  data: AdminKnowledgeGraph;
}

export type CompanionSortField =
  | 'name'
  | 'ownerEmail'
  | 'status'
  | 'sessionCount'
  | 'totalMessages'
  | 'totalCostUsd'
  | 'createdAt';

export interface AdminCompanionListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: CompanionStatus;
  sortBy?: CompanionSortField;
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// API Methods
// ============================================================================

/**
 * List all companions with stats (admin only)
 */
export function listAdminCompanions(
  options?: AdminCompanionListOptions
): Promise<AdminCompanionListResponse> {
  return get<AdminCompanionListResponse>(
    '/admin/companions',
    options as Record<string, string | number | boolean | undefined>
  );
}

/**
 * Get single companion details with full stats (admin only)
 */
export function getAdminCompanion(
  companionId: string
): Promise<AdminCompanionDetailResponse> {
  return get<AdminCompanionDetailResponse>(`/admin/companions/${companionId}`);
}

/**
 * Get paginated images for a companion (admin only)
 */
export function getAdminCompanionImages(
  companionId: string,
  options?: { limit?: number; offset?: number }
): Promise<AdminCompanionImagesResponse> {
  return get<AdminCompanionImagesResponse>(
    `/admin/companions/${companionId}/images`,
    options
  );
}

/**
 * Get knowledge graph data for visualization (admin only)
 */
export function getAdminCompanionKnowledgeGraph(
  companionId: string
): Promise<AdminKnowledgeGraphResponse> {
  return get<AdminKnowledgeGraphResponse>(
    `/admin/companions/${companionId}/knowledge-graph`
  );
}
