/**
 * Admin Companions Repository
 * Data access for admin companion management with aggregated stats
 */

import { sql } from '../db/pool.js';
import type {
  CompanionStatus,
  CompanionSpec,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, validateUuid } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export interface AdminCompanionListItem {
  id: string;
  name: string;
  status: CompanionStatus;
  createdAt: Date;
  spec: CompanionSpec;
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

export interface AdminCompanionDetail extends AdminCompanionListItem {
  isPublic: boolean;
  specVersion: number;
  updatedAt: Date;
  backstory: string | null;
}

export interface AdminCompanionImage {
  id: string;
  s3Url: string;
  width: number;
  height: number;
  emotionalState: string;
  style: string;
  prompt: string | null;
  provider: string;
  createdAt: Date;
  renditions: Record<string, unknown> | null;
}

export interface AdminKnowledgeGraphEntity {
  id: string;
  name: string;
  canonicalName: string;
  entityType: string;
  aliases: string[];
  metadata: JSONObject;
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

export type AdminCompanionSortField =
  | 'name'
  | 'ownerEmail'
  | 'status'
  | 'sessionCount'
  | 'totalMessages'
  | 'totalCostUsd'
  | 'createdAt';

export interface AdminCompanionListFilters extends PaginationOptions {
  search?: string;
  status?: CompanionStatus;
  sortBy?: AdminCompanionSortField;
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Repository
// ============================================================================

export class AdminCompanionsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * List all companions with aggregated stats for admin view
   */
  async listWithStats(
    filters: AdminCompanionListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<AdminCompanionListItem>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    const sortBy = filters.sortBy ?? 'createdAt';
    const sortOrder = filters.sortOrder ?? 'desc';

    // Build WHERE conditions
    const conditions: ReturnType<typeof db>[] = [];

    if (filters.search) {
      conditions.push(db`(c.name ILIKE ${'%' + filters.search + '%'} OR u.email ILIKE ${'%' + filters.search + '%'})`);
    }

    if (filters.status) {
      conditions.push(db`c.status = ${filters.status}`);
    }

    const whereClause = conditions.length > 0
      ? db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`
      : db``;

    // Build ORDER BY based on sortBy field
    const orderColumn = {
      name: db`c.name`,
      ownerEmail: db`u.email`,
      status: db`c.status`,
      sessionCount: db`session_count`,
      totalMessages: db`total_messages`,
      totalCostUsd: db`total_cost_usd`,
      createdAt: db`c.created_at`,
    }[sortBy];

    const orderDirection = sortOrder === 'asc' ? db`ASC` : db`DESC`;

    const result = await db`
      SELECT
        c.id,
        c.name,
        c.status,
        c.created_at,
        c.spec,
        u.id as owner_id,
        u.email as owner_email,
        a.asset_url as avatar_url,
        COALESCE(ss.session_count, 0)::int as session_count,
        COALESCE(ss.total_messages, 0)::int as total_messages,
        COALESCE(ss.total_tokens_input, 0)::bigint as total_tokens_input,
        COALESCE(ss.total_tokens_output, 0)::bigint as total_tokens_output,
        COALESCE(ss.total_cost_usd, 0)::numeric as total_cost_usd,
        COALESCE(img.image_count, 0)::int as image_count,
        COALESCE(vid.video_count, 0)::int as video_count,
        COALESCE(kg.entity_count, 0)::int as entity_count
      FROM companions c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int as session_count,
          SUM(turn_count)::int as total_messages,
          SUM(total_tokens_input)::bigint as total_tokens_input,
          SUM(total_tokens_output)::bigint as total_tokens_output,
          SUM(total_cost_usd)::numeric as total_cost_usd
        FROM sessions s
        WHERE s.companion_id = c.id
      ) ss ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as image_count
        FROM companion_images ci
        WHERE ci.companion_id = c.id::text
      ) img ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as video_count
        FROM video_requests vr
        WHERE vr.companion_id = c.id
      ) vid ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as entity_count
        FROM kg_entities ke
        WHERE ke.companion_id = c.id
      ) kg ON true
      ${whereClause}
      ORDER BY ${orderColumn} ${orderDirection}
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapListItem(row));

    return { data, hasMore };
  }

  /**
   * Get detailed companion info with full stats
   */
  async getDetailWithStats(
    companionId: string,
    tx?: TransactionContext
  ): Promise<AdminCompanionDetail | null> {
    validateUuid(companionId, 'companion.id');
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        c.id,
        c.name,
        c.status,
        c.is_public,
        c.spec,
        c.spec_version,
        c.created_at,
        c.updated_at,
        u.id as owner_id,
        u.email as owner_email,
        a.asset_url as avatar_url,
        COALESCE(ss.session_count, 0)::int as session_count,
        COALESCE(ss.total_messages, 0)::int as total_messages,
        COALESCE(ss.total_tokens_input, 0)::bigint as total_tokens_input,
        COALESCE(ss.total_tokens_output, 0)::bigint as total_tokens_output,
        COALESCE(ss.total_cost_usd, 0)::numeric as total_cost_usd,
        COALESCE(img.image_count, 0)::int as image_count,
        COALESCE(vid.video_count, 0)::int as video_count,
        COALESCE(kg.entity_count, 0)::int as entity_count,
        bs.metadata->>'backstory' as kg_backstory
      FROM companions c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int as session_count,
          SUM(turn_count)::int as total_messages,
          SUM(total_tokens_input)::bigint as total_tokens_input,
          SUM(total_tokens_output)::bigint as total_tokens_output,
          SUM(total_cost_usd)::numeric as total_cost_usd
        FROM sessions s
        WHERE s.companion_id = c.id
      ) ss ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as image_count
        FROM companion_images ci
        WHERE ci.companion_id = c.id::text
      ) img ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as video_count
        FROM video_requests vr
        WHERE vr.companion_id = c.id
      ) vid ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as entity_count
        FROM kg_entities ke
        WHERE ke.companion_id = c.id
      ) kg ON true
      LEFT JOIN kg_entities bs ON bs.companion_id = c.id
        AND bs.name = 'My Backstory'
        AND bs.entity_type = 'concept'
      WHERE c.id = ${companionId}
    `;

    if (!result[0]) {
      return null;
    }

    return this.mapDetail(result[0]);
  }

  /**
   * Get paginated images for a companion
   */
  async getImages(
    companionId: string,
    options: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<AdminCompanionImage>> {
    validateUuid(companionId, 'companion.id');
    const db = this.getSql(tx);
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const result = await db`
      SELECT
        id,
        s3_url,
        width,
        height,
        emotional_state,
        style,
        prompt,
        provider,
        created_at,
        renditions
      FROM companion_images
      WHERE companion_id = ${companionId}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => ({
      id: row.id as string,
      s3Url: row.s3_url as string,
      width: row.width as number,
      height: row.height as number,
      emotionalState: row.emotional_state as string,
      style: row.style as string,
      prompt: row.prompt as string | null,
      provider: row.provider as string,
      createdAt: row.created_at as Date,
      renditions: (row.renditions as Record<string, unknown>) ?? null,
    }));

    return { data, hasMore };
  }

  /**
   * Get knowledge graph entities and edges for visualization
   */
  async getKnowledgeGraph(
    companionId: string,
    tx?: TransactionContext
  ): Promise<AdminKnowledgeGraph> {
    validateUuid(companionId, 'companion.id');
    const db = this.getSql(tx);

    const [entitiesResult, edgesResult] = await Promise.all([
      db`
        SELECT
          id,
          name,
          canonical_name,
          entity_type,
          aliases,
          metadata
        FROM kg_entities
        WHERE companion_id = ${companionId}
        ORDER BY name ASC
        LIMIT 200
      `,
      db`
        SELECT
          id,
          source_entity_id,
          target_entity_id,
          relation_type,
          confidence
        FROM kg_edges
        WHERE companion_id = ${companionId}
          AND status = 'active'
        ORDER BY confidence DESC
        LIMIT 500
      `,
    ]);

    const entities: AdminKnowledgeGraphEntity[] = entitiesResult.map(row => ({
      id: row.id as string,
      name: row.name as string,
      canonicalName: row.canonical_name as string,
      entityType: row.entity_type as string,
      aliases: row.aliases as string[],
      metadata: row.metadata as JSONObject,
    }));

    const edges: AdminKnowledgeGraphEdge[] = edgesResult.map(row => ({
      id: row.id as string,
      sourceEntityId: row.source_entity_id as string,
      targetEntityId: row.target_entity_id as string,
      relationType: row.relation_type as string,
      confidence: row.confidence as number,
    }));

    return { entities, edges };
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapListItem(row: Record<string, unknown>): AdminCompanionListItem {
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as CompanionStatus,
      createdAt: row.created_at as Date,
      spec: row.spec as CompanionSpec,
      ownerId: row.owner_id as string,
      ownerEmail: row.owner_email as string,
      avatarUrl: row.avatar_url as string | null,
      sessionCount: Number(row.session_count ?? 0),
      totalMessages: Number(row.total_messages ?? 0),
      totalTokensInput: Number(row.total_tokens_input ?? 0),
      totalTokensOutput: Number(row.total_tokens_output ?? 0),
      totalCostUsd: Number(row.total_cost_usd ?? 0),
      imageCount: Number(row.image_count ?? 0),
      videoCount: Number(row.video_count ?? 0),
      entityCount: Number(row.entity_count ?? 0),
    };
  }

  private mapDetail(row: Record<string, unknown>): AdminCompanionDetail {
    // Get backstory from KG entity or fall back to spec.identity.backstory
    const kgBackstory = row.kg_backstory as string | null;
    const spec = row.spec as CompanionSpec;
    const specBackstory = (spec?.identity as Record<string, unknown>)?.backstory as string | undefined;
    const backstory = kgBackstory || specBackstory || null;

    return {
      ...this.mapListItem(row),
      isPublic: row.is_public as boolean,
      specVersion: row.spec_version as number,
      updatedAt: row.updated_at as Date,
      backstory,
    };
  }
}

// Singleton instance
let adminCompanionsRepositoryInstance: AdminCompanionsRepository | null = null;

export function getAdminCompanionsRepository(): AdminCompanionsRepository {
  if (!adminCompanionsRepositoryInstance) {
    adminCompanionsRepositoryInstance = new AdminCompanionsRepository();
  }
  return adminCompanionsRepositoryInstance;
}
