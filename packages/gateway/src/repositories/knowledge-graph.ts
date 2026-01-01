/**
 * Knowledge Graph Repository
 * Data access for kg_entities and kg_edges tables
 * Handles entity extraction and relationship management
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  KGEntity,
  KGEntityInsert,
  KGEdge,
  KGEdgeInsert,
  KGEdgeStatus,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Entity with relationship counts
 */
export interface KGEntityWithStats extends KGEntity {
  outgoingEdgeCount: number;
  incomingEdgeCount: number;
}

/**
 * Edge with entity details
 */
export interface KGEdgeWithEntities extends KGEdge {
  sourceEntity: KGEntity;
  targetEntity: KGEntity;
}

/**
 * Entity search result
 */
export interface EntitySearchResult {
  entity: KGEntity;
  matchScore: number;
  matchedField: 'name' | 'alias' | 'canonical_name';
}

/**
 * Graph traversal result
 */
export interface TraversalResult {
  entity: KGEntity;
  depth: number;
  path: string[];
  relationPath: string[];
}

/**
 * Entity list filters
 */
export interface EntityListFilters extends PaginationOptions {
  companionId?: string;
  entityType?: string;
  search?: string;
}

/**
 * Edge list filters
 */
export interface EdgeListFilters extends PaginationOptions {
  companionId?: string;
  relationType?: string;
  status?: KGEdgeStatus;
  minConfidence?: number;
  sourceEntityId?: string;
  targetEntityId?: string;
}

/**
 * Relationship summary
 */
export interface RelationshipSummary {
  relationType: string;
  count: number;
  avgConfidence: number;
}

// ============================================================================
// Repository
// ============================================================================

export class KnowledgeGraphRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Entities
  // ===========================================================================

  async findEntityById(id: string, tx?: TransactionContext): Promise<KGEntity | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
      FROM kg_entities
      WHERE id = ${id}
    `;

    return result[0] ? this.mapEntity(result[0]) : null;
  }

  async findEntityByIdWithStats(id: string, tx?: TransactionContext): Promise<KGEntityWithStats | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        e.id, e.user_id, e.companion_id, e.name, e.canonical_name,
        e.entity_type, e.aliases, e.metadata, e.source_event_id,
        e.created_at, e.updated_at,
        (SELECT COUNT(*) FROM kg_edges WHERE source_entity_id = e.id AND status = 'active') as outgoing_count,
        (SELECT COUNT(*) FROM kg_edges WHERE target_entity_id = e.id AND status = 'active') as incoming_count
      FROM kg_entities e
      WHERE e.id = ${id}
    `;

    if (!result[0]) return null;

    return {
      ...this.mapEntity(result[0]),
      outgoingEdgeCount: Number(result[0].outgoing_count ?? 0),
      incomingEdgeCount: Number(result[0].incoming_count ?? 0),
    };
  }

  async findEntityByCanonicalName(
    userId: string,
    companionId: string,
    canonicalName: string,
    tx?: TransactionContext
  ): Promise<KGEntity | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
      FROM kg_entities
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND canonical_name = ${canonicalName}
    `;

    return result[0] ? this.mapEntity(result[0]) : null;
  }

  async searchEntities(
    userId: string,
    companionId: string,
    query: string,
    options: { limit?: number; entityType?: string } = {},
    tx?: TransactionContext
  ): Promise<EntitySearchResult[]> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 20;
    const normalizedQuery = query.toLowerCase().trim();

    const result = await db`
      SELECT
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at,
        CASE
          WHEN LOWER(canonical_name) = ${normalizedQuery} THEN 1.0
          WHEN LOWER(name) = ${normalizedQuery} THEN 0.9
          WHEN ${normalizedQuery} = ANY(SELECT LOWER(unnest(aliases))) THEN 0.8
          WHEN LOWER(canonical_name) LIKE ${normalizedQuery + '%'} THEN 0.7
          WHEN LOWER(name) LIKE ${normalizedQuery + '%'} THEN 0.6
          WHEN LOWER(canonical_name) LIKE ${'%' + normalizedQuery + '%'} THEN 0.5
          WHEN LOWER(name) LIKE ${'%' + normalizedQuery + '%'} THEN 0.4
          ELSE 0.3
        END as match_score,
        CASE
          WHEN LOWER(canonical_name) = ${normalizedQuery} OR LOWER(canonical_name) LIKE ${normalizedQuery + '%'} OR LOWER(canonical_name) LIKE ${'%' + normalizedQuery + '%'} THEN 'canonical_name'
          WHEN LOWER(name) = ${normalizedQuery} OR LOWER(name) LIKE ${normalizedQuery + '%'} OR LOWER(name) LIKE ${'%' + normalizedQuery + '%'} THEN 'name'
          ELSE 'alias'
        END as matched_field
      FROM kg_entities
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND (
          LOWER(canonical_name) LIKE ${'%' + normalizedQuery + '%'}
          OR LOWER(name) LIKE ${'%' + normalizedQuery + '%'}
          OR ${normalizedQuery} ILIKE ANY(aliases)
        )
        ${options.entityType ? db`AND entity_type = ${options.entityType}` : db``}
      ORDER BY match_score DESC, name ASC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      entity: this.mapEntity(row),
      matchScore: Number(row.match_score),
      matchedField: row.matched_field as 'name' | 'alias' | 'canonical_name',
    }));
  }

  async createEntity(data: KGEntityInsert, tx?: TransactionContext): Promise<KGEntity> {
    const db = this.getSql(tx);
    const canonicalName = data.canonical_name ?? data.name.toLowerCase().trim();

    try {
      const result = await db`
        INSERT INTO kg_entities (
          user_id, companion_id, name, canonical_name,
          entity_type, aliases, metadata, source_event_id
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.name},
          ${canonicalName},
          ${data.entity_type},
          ${data.aliases ?? []},
          ${JSON.stringify(data.metadata ?? {})},
          ${data.source_event_id ?? null}
        )
        RETURNING
          id, user_id, companion_id, name, canonical_name,
          entity_type, aliases, metadata, source_event_id,
          created_at, updated_at
      `;

      const entity = this.mapEntity(result[0]!);
      logger.debug({ entityId: entity.id, name: data.name }, 'Entity created');
      return entity;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('KGEntity', 'canonical_name', canonicalName);
      }
      throw wrapDatabaseError(error, 'knowledgeGraph.createEntity');
    }
  }

  async updateEntity(
    id: string,
    data: Partial<Omit<KGEntityInsert, 'user_id' | 'companion_id'>>,
    tx?: TransactionContext
  ): Promise<KGEntity> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE kg_entities
      SET
        name = COALESCE(${data.name ?? null}, name),
        canonical_name = COALESCE(${data.canonical_name ?? null}, canonical_name),
        entity_type = COALESCE(${data.entity_type ?? null}, entity_type),
        aliases = COALESCE(${data.aliases ?? null}, aliases),
        metadata = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}, metadata)
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('KGEntity', id);
    }

    logger.debug({ entityId: id }, 'Entity updated');
    return this.mapEntity(result[0]);
  }

  async addAlias(id: string, alias: string, tx?: TransactionContext): Promise<KGEntity> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE kg_entities
      SET aliases = array_append(aliases, ${alias})
      WHERE id = ${id}
        AND NOT ${alias} = ANY(aliases)
      RETURNING
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
    `;

    if (!result[0]) {
      // Either not found or alias already exists, try to get current state
      const entity = await this.findEntityById(id, tx);
      if (!entity) {
        throw new NotFoundError('KGEntity', id);
      }
      return entity;
    }

    return this.mapEntity(result[0]);
  }

  async removeAlias(id: string, alias: string, tx?: TransactionContext): Promise<KGEntity> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE kg_entities
      SET aliases = array_remove(aliases, ${alias})
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('KGEntity', id);
    }

    return this.mapEntity(result[0]);
  }

  async mergeEntities(
    primaryId: string,
    secondaryId: string,
    tx?: TransactionContext
  ): Promise<KGEntity> {
    const db = this.getSql(tx);

    // Get both entities
    const [primary, secondary] = await Promise.all([
      this.findEntityById(primaryId, tx),
      this.findEntityById(secondaryId, tx),
    ]);

    if (!primary) throw new NotFoundError('KGEntity', primaryId);
    if (!secondary) throw new NotFoundError('KGEntity', secondaryId);

    // Merge aliases
    const mergedAliases = [...new Set([
      ...primary.aliases,
      ...secondary.aliases,
      secondary.name,
    ])].filter(a => a !== primary.name);

    // Update edges to point to primary
    await db`
      UPDATE kg_edges
      SET source_entity_id = ${primaryId}
      WHERE source_entity_id = ${secondaryId}
    `;

    await db`
      UPDATE kg_edges
      SET target_entity_id = ${primaryId}
      WHERE target_entity_id = ${secondaryId}
    `;

    // Update primary with merged data
    const result = await db`
      UPDATE kg_entities
      SET
        aliases = ${mergedAliases},
        metadata = metadata || ${JSON.stringify(secondary.metadata)}
      WHERE id = ${primaryId}
      RETURNING
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
    `;

    // Delete secondary
    await db`DELETE FROM kg_entities WHERE id = ${secondaryId}`;

    logger.info({ primaryId, secondaryId }, 'Entities merged');
    return this.mapEntity(result[0]!);
  }

  async deleteEntity(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`DELETE FROM kg_entities WHERE id = ${id}`;

    if (result.count === 0) {
      throw new NotFoundError('KGEntity', id);
    }

    logger.debug({ entityId: id }, 'Entity deleted');
  }

  async listEntities(
    userId: string,
    filters: EntityListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<KGEntity>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, companion_id, name, canonical_name,
        entity_type, aliases, metadata, source_event_id,
        created_at, updated_at
      FROM kg_entities
      WHERE user_id = ${userId}
        ${filters.companionId ? db`AND companion_id = ${filters.companionId}` : db``}
        ${filters.entityType ? db`AND entity_type = ${filters.entityType}` : db``}
        ${filters.search ? db`AND (
          LOWER(name) LIKE ${'%' + filters.search.toLowerCase() + '%'}
          OR LOWER(canonical_name) LIKE ${'%' + filters.search.toLowerCase() + '%'}
        )` : db``}
      ORDER BY name ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapEntity(row));

    return { data, hasMore };
  }

  async getEntityTypes(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<{ entityType: string; count: number }[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT entity_type, COUNT(*) as count
      FROM kg_entities
      WHERE user_id = ${userId} AND companion_id = ${companionId}
      GROUP BY entity_type
      ORDER BY count DESC
    `;

    return result.map(row => ({
      entityType: row.entity_type as string,
      count: Number(row.count),
    }));
  }

  async countEntities(
    userId: string,
    companionId?: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT COUNT(*) as count
      FROM kg_entities
      WHERE user_id = ${userId}
        ${companionId ? db`AND companion_id = ${companionId}` : db``}
    `;
    return Number(result[0]?.count ?? 0);
  }

  // ===========================================================================
  // Edges
  // ===========================================================================

  async findEdgeById(id: string, tx?: TransactionContext): Promise<KGEdge | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
      FROM kg_edges
      WHERE id = ${id}
    `;

    return result[0] ? this.mapEdge(result[0]) : null;
  }

  async findEdgeByIdWithEntities(id: string, tx?: TransactionContext): Promise<KGEdgeWithEntities | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        e.id, e.user_id, e.companion_id, e.source_entity_id, e.target_entity_id,
        e.relation_type, e.confidence, e.status, e.source_event_id,
        e.first_seen, e.last_seen, e.last_confirmed, e.mention_count,
        e.metadata, e.created_at, e.updated_at,
        row_to_json(se.*) as source_entity,
        row_to_json(te.*) as target_entity
      FROM kg_edges e
      JOIN kg_entities se ON e.source_entity_id = se.id
      JOIN kg_entities te ON e.target_entity_id = te.id
      WHERE e.id = ${id}
    `;

    if (!result[0]) return null;

    return {
      ...this.mapEdge(result[0]),
      sourceEntity: this.mapEntity(result[0].source_entity as Record<string, unknown>),
      targetEntity: this.mapEntity(result[0].target_entity as Record<string, unknown>),
    };
  }

  async findEdge(
    sourceEntityId: string,
    targetEntityId: string,
    relationType: string,
    tx?: TransactionContext
  ): Promise<KGEdge | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
      FROM kg_edges
      WHERE source_entity_id = ${sourceEntityId}
        AND target_entity_id = ${targetEntityId}
        AND relation_type = ${relationType}
    `;

    return result[0] ? this.mapEdge(result[0]) : null;
  }

  async createEdge(data: KGEdgeInsert, tx?: TransactionContext): Promise<KGEdge> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO kg_edges (
          user_id, companion_id, source_entity_id, target_entity_id,
          relation_type, confidence, status, source_event_id, metadata
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.source_entity_id},
          ${data.target_entity_id},
          ${data.relation_type},
          ${data.confidence ?? 1.0},
          ${data.status ?? 'active'},
          ${data.source_event_id ?? null},
          ${JSON.stringify(data.metadata ?? {})}
        )
        RETURNING
          id, user_id, companion_id, source_entity_id, target_entity_id,
          relation_type, confidence, status, source_event_id,
          first_seen, last_seen, last_confirmed, mention_count,
          metadata, created_at, updated_at
      `;

      const edge = this.mapEdge(result[0]!);
      logger.debug({ edgeId: edge.id, relationType: data.relation_type }, 'Edge created');
      return edge;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError(
          'KGEdge',
          'source_target_relation',
          `${data.source_entity_id}:${data.target_entity_id}:${data.relation_type}`
        );
      }
      throw wrapDatabaseError(error, 'knowledgeGraph.createEdge');
    }
  }

  async upsertEdge(data: KGEdgeInsert, tx?: TransactionContext): Promise<KGEdge> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO kg_edges (
        user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id, metadata
      ) VALUES (
        ${data.user_id},
        ${data.companion_id},
        ${data.source_entity_id},
        ${data.target_entity_id},
        ${data.relation_type},
        ${data.confidence ?? 1.0},
        ${data.status ?? 'active'},
        ${data.source_event_id ?? null},
        ${JSON.stringify(data.metadata ?? {})}
      )
      ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO UPDATE SET
        confidence = GREATEST(kg_edges.confidence, EXCLUDED.confidence),
        status = CASE
          WHEN EXCLUDED.status = 'active' THEN 'active'
          ELSE kg_edges.status
        END,
        last_seen = NOW(),
        mention_count = kg_edges.mention_count + 1,
        metadata = kg_edges.metadata || EXCLUDED.metadata
      RETURNING
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
    `;

    return this.mapEdge(result[0]!);
  }

  async updateEdge(
    id: string,
    data: Partial<Pick<KGEdgeInsert, 'confidence' | 'status' | 'metadata'>>,
    tx?: TransactionContext
  ): Promise<KGEdge> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE kg_edges
      SET
        confidence = COALESCE(${data.confidence ?? null}, confidence),
        status = COALESCE(${data.status ?? null}, status),
        metadata = COALESCE(${data.metadata ? JSON.stringify(data.metadata) : null}, metadata)
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('KGEdge', id);
    }

    return this.mapEdge(result[0]);
  }

  async confirmEdge(id: string, tx?: TransactionContext): Promise<KGEdge> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE kg_edges
      SET
        status = 'active',
        last_confirmed = NOW(),
        confidence = LEAST(confidence + 0.1, 1.0)
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('KGEdge', id);
    }

    return this.mapEdge(result[0]);
  }

  async deprecateEdge(id: string, tx?: TransactionContext): Promise<KGEdge> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE kg_edges
      SET status = 'deprecated'
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('KGEdge', id);
    }

    logger.debug({ edgeId: id }, 'Edge deprecated');
    return this.mapEdge(result[0]);
  }

  async deleteEdge(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`DELETE FROM kg_edges WHERE id = ${id}`;

    if (result.count === 0) {
      throw new NotFoundError('KGEdge', id);
    }

    logger.debug({ edgeId: id }, 'Edge deleted');
  }

  async getOutgoingEdges(
    entityId: string,
    options: { status?: KGEdgeStatus; relationType?: string } = {},
    tx?: TransactionContext
  ): Promise<KGEdge[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
      FROM kg_edges
      WHERE source_entity_id = ${entityId}
        ${options.status ? db`AND status = ${options.status}` : db``}
        ${options.relationType ? db`AND relation_type = ${options.relationType}` : db``}
      ORDER BY confidence DESC
    `;

    return result.map(row => this.mapEdge(row));
  }

  async getIncomingEdges(
    entityId: string,
    options: { status?: KGEdgeStatus; relationType?: string } = {},
    tx?: TransactionContext
  ): Promise<KGEdge[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
      FROM kg_edges
      WHERE target_entity_id = ${entityId}
        ${options.status ? db`AND status = ${options.status}` : db``}
        ${options.relationType ? db`AND relation_type = ${options.relationType}` : db``}
      ORDER BY confidence DESC
    `;

    return result.map(row => this.mapEdge(row));
  }

  async listEdges(
    userId: string,
    filters: EdgeListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<KGEdge>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
      FROM kg_edges
      WHERE user_id = ${userId}
        ${filters.companionId ? db`AND companion_id = ${filters.companionId}` : db``}
        ${filters.relationType ? db`AND relation_type = ${filters.relationType}` : db``}
        ${filters.status ? db`AND status = ${filters.status}` : db``}
        ${filters.minConfidence !== undefined ? db`AND confidence >= ${filters.minConfidence}` : db``}
        ${filters.sourceEntityId ? db`AND source_entity_id = ${filters.sourceEntityId}` : db``}
        ${filters.targetEntityId ? db`AND target_entity_id = ${filters.targetEntityId}` : db``}
      ORDER BY confidence DESC, created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapEdge(row));

    return { data, hasMore };
  }

  async getRelationTypes(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<RelationshipSummary[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        relation_type,
        COUNT(*) as count,
        AVG(confidence) as avg_confidence
      FROM kg_edges
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'active'
      GROUP BY relation_type
      ORDER BY count DESC
    `;

    return result.map(row => ({
      relationType: row.relation_type as string,
      count: Number(row.count),
      avgConfidence: Number(row.avg_confidence),
    }));
  }

  async countEdges(
    userId: string,
    companionId?: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT COUNT(*) as count
      FROM kg_edges
      WHERE user_id = ${userId}
        ${companionId ? db`AND companion_id = ${companionId}` : db``}
        AND status = 'active'
    `;
    return Number(result[0]?.count ?? 0);
  }

  // ===========================================================================
  // Graph Traversal
  // ===========================================================================

  async getNeighbors(
    entityId: string,
    options: { depth?: number; status?: KGEdgeStatus } = {},
    tx?: TransactionContext
  ): Promise<KGEntity[]> {
    const db = this.getSql(tx);
    const depth = options.depth ?? 1;
    const status = options.status ?? 'active';

    // Use recursive CTE for multi-hop traversal
    const result = await db`
      WITH RECURSIVE neighbors AS (
        -- Base case: direct neighbors
        SELECT DISTINCT
          CASE
            WHEN e.source_entity_id = ${entityId} THEN e.target_entity_id
            ELSE e.source_entity_id
          END as entity_id,
          1 as depth
        FROM kg_edges e
        WHERE (e.source_entity_id = ${entityId} OR e.target_entity_id = ${entityId})
          AND e.status = ${status}

        UNION

        -- Recursive case
        SELECT DISTINCT
          CASE
            WHEN e.source_entity_id = n.entity_id THEN e.target_entity_id
            ELSE e.source_entity_id
          END as entity_id,
          n.depth + 1
        FROM kg_edges e
        JOIN neighbors n ON (e.source_entity_id = n.entity_id OR e.target_entity_id = n.entity_id)
        WHERE n.depth < ${depth}
          AND e.status = ${status}
          AND CASE
            WHEN e.source_entity_id = n.entity_id THEN e.target_entity_id
            ELSE e.source_entity_id
          END != ${entityId}
      )
      SELECT DISTINCT ent.*
      FROM neighbors n
      JOIN kg_entities ent ON n.entity_id = ent.id
      WHERE ent.id != ${entityId}
    `;

    return result.map(row => this.mapEntity(row));
  }

  async findPath(
    sourceEntityId: string,
    targetEntityId: string,
    maxDepth: number = 5,
    tx?: TransactionContext
  ): Promise<TraversalResult[] | null> {
    const db = this.getSql(tx);

    const result = await db`
      WITH RECURSIVE path_search AS (
        -- Base case
        SELECT
          e.target_entity_id as entity_id,
          ARRAY[${sourceEntityId}::uuid, e.target_entity_id] as path,
          ARRAY[e.relation_type] as relations,
          1 as depth
        FROM kg_edges e
        WHERE e.source_entity_id = ${sourceEntityId}
          AND e.status = 'active'

        UNION ALL

        -- Recursive case
        SELECT
          e.target_entity_id,
          ps.path || e.target_entity_id,
          ps.relations || e.relation_type,
          ps.depth + 1
        FROM kg_edges e
        JOIN path_search ps ON e.source_entity_id = ps.entity_id
        WHERE ps.depth < ${maxDepth}
          AND e.status = 'active'
          AND NOT e.target_entity_id = ANY(ps.path)
      )
      SELECT
        ent.*,
        ps.depth,
        ps.path,
        ps.relations
      FROM path_search ps
      JOIN kg_entities ent ON ps.entity_id = ent.id
      WHERE ps.entity_id = ${targetEntityId}
      ORDER BY ps.depth
      LIMIT 1
    `;

    if (!result[0]) return null;

    // Build the full path with entities
    const pathIds = result[0].path as string[];
    const entities = await Promise.all(
      pathIds.map(id => this.findEntityById(id, tx))
    );

    return entities.filter(Boolean).map((entity, index) => ({
      entity: entity!,
      depth: index,
      path: pathIds.slice(0, index + 1),
      relationPath: (result[0].relations as string[]).slice(0, index),
    }));
  }

  async getSubgraph(
    entityId: string,
    depth: number = 2,
    tx?: TransactionContext
  ): Promise<{ entities: KGEntity[]; edges: KGEdge[] }> {
    const db = this.getSql(tx);

    // Get all reachable entities within depth
    const entities = await this.getNeighbors(entityId, { depth }, tx);
    const startEntity = await this.findEntityById(entityId, tx);

    if (startEntity) {
      entities.unshift(startEntity);
    }

    const entityIds = entities.map(e => e.id);

    // Get all edges between these entities
    const edgeResult = await db`
      SELECT
        id, user_id, companion_id, source_entity_id, target_entity_id,
        relation_type, confidence, status, source_event_id,
        first_seen, last_seen, last_confirmed, mention_count,
        metadata, created_at, updated_at
      FROM kg_edges
      WHERE source_entity_id = ANY(${entityIds})
        AND target_entity_id = ANY(${entityIds})
        AND status = 'active'
    `;

    const edges = edgeResult.map(row => this.mapEdge(row));

    return { entities, edges };
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapEntity(row: Record<string, unknown>): KGEntity {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      companion_id: row.companion_id as string,
      name: row.name as string,
      canonical_name: row.canonical_name as string,
      entity_type: row.entity_type as string,
      aliases: row.aliases as string[],
      metadata: row.metadata as JSONObject,
      source_event_id: row.source_event_id as string | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapEdge(row: Record<string, unknown>): KGEdge {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      companion_id: row.companion_id as string,
      source_entity_id: row.source_entity_id as string,
      target_entity_id: row.target_entity_id as string,
      relation_type: row.relation_type as string,
      confidence: row.confidence as number,
      status: row.status as KGEdgeStatus,
      source_event_id: row.source_event_id as string | null,
      first_seen: row.first_seen as Date,
      last_seen: row.last_seen as Date,
      last_confirmed: row.last_confirmed as Date | null,
      mention_count: row.mention_count as number,
      metadata: row.metadata as JSONObject,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}

// Singleton instance
let knowledgeGraphRepository: KnowledgeGraphRepository | null = null;

export function getKnowledgeGraphRepository(): KnowledgeGraphRepository {
  if (!knowledgeGraphRepository) {
    knowledgeGraphRepository = new KnowledgeGraphRepository();
  }
  return knowledgeGraphRepository;
}
