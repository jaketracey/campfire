/**
 * Memories Repository
 * Data access for memories table with vector search support
 */

import postgres from 'postgres';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  Memory,
  MemoryInsert,
  MemoryContentType,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult, DateRangeFilter } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

/**
 * Memory status type
 */
export type MemoryStatus = 'active' | 'archived' | 'deleted';

/**
 * Memory with similarity score (from vector search)
 */
export interface MemoryWithSimilarity extends Memory {
  similarity: number;
}

/**
 * Memory with pinned information
 */
export interface MemoryWithPinInfo extends Memory {
  is_pinned: boolean;
  pin_order: number | null;
  pinned_at: Date | null;
}

/**
 * Memory list filters
 */
export interface MemoryListFilters extends PaginationOptions {
  userId: string;
  companionId: string;
  contentType?: MemoryContentType;
  status?: MemoryStatus;
  minImportance?: number;
  tags?: string[];
  dateRange?: DateRangeFilter;
}

/**
 * User-scoped memory list filters (companionId optional)
 */
export interface UserMemoryListFilters extends PaginationOptions {
  userId: string;
  companionId?: string;
  contentType?: MemoryContentType;
  status?: MemoryStatus;
  minImportance?: number;
  tags?: string[];
}

/**
 * Composite scoring weights for vector search
 */
export interface CompositeWeights {
  similarity?: number;  // default 0.6
  importance?: number;  // default 0.2
  recency?: number;     // default 0.1
  access?: number;      // default 0.1
}

/**
 * Default composite scoring weights
 */
export const DEFAULT_COMPOSITE_WEIGHTS: Required<CompositeWeights> = {
  similarity: 0.6,
  importance: 0.2,
  recency: 0.1,
  access: 0.1,
};

/**
 * Vector search options
 */
export interface VectorSearchOptions {
  userId: string;
  companionId: string;
  embedding: number[];
  limit?: number;
  minSimilarity?: number;
  contentTypes?: MemoryContentType[];
  minImportance?: number;
  /** Enable composite scoring (similarity + importance + recency + access) */
  useCompositeScoring?: boolean;
  /** Custom weights for composite scoring */
  weights?: CompositeWeights;
  /** Keywords for hybrid search (vector + keyword matching) */
  keywords?: string[];
  /** Boost factor for keyword matches in hybrid search (default 0.3) */
  keywordBoost?: number;
}

/**
 * Full-text search options
 */
export interface TextSearchOptions {
  userId: string;
  companionId: string;
  query: string;
  limit?: number;
  contentTypes?: MemoryContentType[];
}

export class MemoriesRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Basic CRUD
  // ===========================================================================

  async findById(id: string, tx?: TransactionContext): Promise<Memory | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at
      FROM memories
      WHERE id = ${id}
    `;

    return result[0] ? this.mapMemory(result[0]) : null;
  }

  async create(data: MemoryInsert, tx?: TransactionContext): Promise<Memory> {
    const db = this.getSql(tx);

    try {
      // Handle embedding separately since it needs special formatting
      const embeddingValue = data.embedding
        ? `[${data.embedding.join(',')}]`
        : null;

      const result = await db`
        INSERT INTO memories (
          user_id, companion_id, content, content_type, status,
          embedding, importance, source_event_id, source_turn_id,
          metadata, tags, expires_at
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.content},
          ${data.content_type ?? 'fact'},
          'active',
          ${embeddingValue ? db.unsafe(`'${embeddingValue}'::vector`) : null},
          ${data.importance ?? 0.5},
          ${data.source_event_id ?? null},
          ${data.source_turn_id ?? null},
          ${db.json((data.metadata ?? {}) as postgres.JSONValue)},
          ${[] as string[]},
          ${data.expires_at ?? null}
        )
        RETURNING
          id, user_id, companion_id, content, content_type, status,
          importance, access_count, last_accessed_at,
          source_event_id, source_turn_id, metadata, tags,
          valid_from, valid_until, expires_at, created_at, updated_at
      `;

      const memory = this.mapMemory(result[0]!);
      logger.debug({ memoryId: memory.id, userId: data.user_id }, 'Memory created');
      return memory;
    } catch (error) {
      throw wrapDatabaseError(error, 'memories.create');
    }
  }

  async update(
    id: string,
    data: Partial<Omit<MemoryInsert, 'user_id' | 'companion_id'>>,
    tx?: TransactionContext
  ): Promise<Memory> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE memories
      SET
        content = COALESCE(${data.content ?? null}, content),
        content_type = COALESCE(${data.content_type ?? null}, content_type),
        importance = COALESCE(${data.importance ?? null}, importance),
        metadata = COALESCE(${data.metadata ? db.json(data.metadata as postgres.JSONValue) : null}, metadata),
        expires_at = COALESCE(${data.expires_at ?? null}, expires_at)
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Memory', id);
    }

    return this.mapMemory(result[0]);
  }

  async updateEmbedding(
    id: string,
    embedding: number[],
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    const embeddingValue = `[${embedding.join(',')}]`;

    await db`
      UPDATE memories
      SET embedding = ${db.unsafe(`'${embeddingValue}'::vector`)}
      WHERE id = ${id}
    `;
  }

  async archive(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE memories
      SET status = 'archived'
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('Memory', id);
    }
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE memories
      SET status = 'deleted'
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('Memory', id);
    }
  }

  async hardDelete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM memories
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('Memory', id);
    }
  }

  // ===========================================================================
  // Vector Search
  // ===========================================================================

  async searchByVector(
    options: VectorSearchOptions,
    tx?: TransactionContext
  ): Promise<MemoryWithSimilarity[]> {
    // Get vector search results
    const vectorResults = await this.vectorSearchCore(options, tx);

    // If no keywords provided, return vector results directly
    if (!options.keywords?.length) {
      return vectorResults;
    }

    // Hybrid search: combine vector results with keyword results using RRF
    const keywordResults = await this.searchByText({
      userId: options.userId,
      companionId: options.companionId,
      query: options.keywords.join(' '),
      limit: options.limit ?? 10,
      contentTypes: options.contentTypes,
    }, tx);

    return this.mergeWithRRF(
      vectorResults,
      keywordResults,
      options.keywordBoost ?? 0.3,
      options.limit ?? 10
    );
  }

  /**
   * Core vector search with optional composite scoring
   */
  private async vectorSearchCore(
    options: VectorSearchOptions,
    tx?: TransactionContext
  ): Promise<MemoryWithSimilarity[]> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 10;
    const minSimilarity = options.minSimilarity ?? 0.7;
    const embeddingValue = `[${options.embedding.join(',')}]`;
    const useComposite = options.useCompositeScoring ?? true; // Default to composite scoring

    // Build conditions
    const conditions: ReturnType<typeof db>[] = [
      db`user_id = ${options.userId}`,
      db`companion_id = ${options.companionId}`,
      db`status = 'active'`,
      db`embedding IS NOT NULL`,
    ];

    if (options.contentTypes && options.contentTypes.length > 0) {
      conditions.push(db`content_type = ANY(${options.contentTypes})`);
    }
    if (options.minImportance !== undefined) {
      conditions.push(db`importance >= ${options.minImportance}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    if (useComposite) {
      // Composite scoring: combine similarity, importance, recency, and access frequency
      const weights = {
        ...DEFAULT_COMPOSITE_WEIGHTS,
        ...options.weights,
      };

      const result = await db`
        SELECT
          id, user_id, companion_id, content, content_type, status,
          importance, access_count, last_accessed_at,
          source_event_id, source_turn_id, metadata, tags,
          valid_from, valid_until, expires_at, created_at, updated_at,
          1 - (embedding <=> ${db.unsafe(`'${embeddingValue}'::vector`)}) as similarity,
          GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW() - created_at)) / (365 * 86400)) as recency_score,
          LEAST(1.0, COALESCE(access_count, 0)::real / 10) as access_score,
          (
            ${weights.similarity} * (1 - (embedding <=> ${db.unsafe(`'${embeddingValue}'::vector`)})) +
            ${weights.importance} * importance +
            ${weights.recency} * GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW() - created_at)) / (365 * 86400)) +
            ${weights.access} * LEAST(1.0, COALESCE(access_count, 0)::real / 10)
          ) as composite_score
        FROM memories
        ${whereClause}
          AND 1 - (embedding <=> ${db.unsafe(`'${embeddingValue}'::vector`)}) >= ${minSimilarity}
        ORDER BY composite_score DESC
        LIMIT ${limit}
      `;

      return result.map(row => ({
        ...this.mapMemory(row),
        similarity: parseFloat(row['similarity'] as string),
      }));
    } else {
      // Simple similarity-only scoring (original behavior)
      const result = await db`
        SELECT
          id, user_id, companion_id, content, content_type, status,
          importance, access_count, last_accessed_at,
          source_event_id, source_turn_id, metadata, tags,
          valid_from, valid_until, expires_at, created_at, updated_at,
          1 - (embedding <=> ${db.unsafe(`'${embeddingValue}'::vector`)}) as similarity
        FROM memories
        ${whereClause}
          AND 1 - (embedding <=> ${db.unsafe(`'${embeddingValue}'::vector`)}) >= ${minSimilarity}
        ORDER BY embedding <=> ${db.unsafe(`'${embeddingValue}'::vector`)}
        LIMIT ${limit}
      `;

      return result.map(row => ({
        ...this.mapMemory(row),
        similarity: parseFloat(row['similarity'] as string),
      }));
    }
  }

  /**
   * Merge vector and keyword results using Reciprocal Rank Fusion (RRF)
   * RRF formula: score = sum(1 / (k + rank)) for each result list
   */
  private mergeWithRRF(
    vectorResults: MemoryWithSimilarity[],
    keywordResults: Memory[],
    keywordBoost: number,
    limit: number
  ): MemoryWithSimilarity[] {
    const k = 60; // RRF constant (commonly used value)
    const scores = new Map<string, { score: number; memory: MemoryWithSimilarity }>();

    // Score vector results
    vectorResults.forEach((memory, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      scores.set(memory.id, {
        score: rrfScore,
        memory,
      });
    });

    // Score keyword results with boost factor
    keywordResults.forEach((memory, rank) => {
      const rrfScore = keywordBoost / (k + rank + 1);
      const existing = scores.get(memory.id);

      if (existing) {
        // Memory found in both - add scores
        existing.score += rrfScore;
      } else {
        // Only in keyword results - create new entry
        scores.set(memory.id, {
          score: rrfScore,
          memory: {
            ...memory,
            similarity: 0.5, // Default similarity for keyword-only matches
          },
        });
      }
    });

    // Sort by combined RRF score and return top N
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => entry.memory);
  }

  async searchByVectorUsingFunction(
    options: VectorSearchOptions,
    tx?: TransactionContext
  ): Promise<MemoryWithSimilarity[]> {
    const db = this.getSql(tx);
    const embeddingValue = `[${options.embedding.join(',')}]`;

    const result = await db`
      SELECT * FROM search_memories_by_embedding(
        ${options.userId},
        ${options.companionId},
        ${db.unsafe(`'${embeddingValue}'::vector(1536)`)},
        ${options.limit ?? 10},
        ${options.minSimilarity ?? 0.7}
      )
    `;

    return result.map(row => ({
      id: row['id'] as string,
      user_id: options.userId,
      companion_id: options.companionId,
      content: row['content'] as string,
      content_type: row['content_type'] as MemoryContentType,
      embedding: null,
      importance: row['importance'] as number,
      source_event_id: null,
      source_turn_id: null,
      metadata: row['metadata'] as JSONObject,
      expires_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      similarity: row['similarity'] as number,
    }));
  }

  // ===========================================================================
  // Full-text Search
  // ===========================================================================

  async searchByText(
    options: TextSearchOptions,
    tx?: TransactionContext
  ): Promise<Memory[]> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 20;

    const conditions: ReturnType<typeof db>[] = [
      db`user_id = ${options.userId}`,
      db`companion_id = ${options.companionId}`,
      db`status = 'active'`,
      db`to_tsvector('english', content) @@ plainto_tsquery('english', ${options.query})`,
    ];

    if (options.contentTypes && options.contentTypes.length > 0) {
      conditions.push(db`content_type = ANY(${options.contentTypes})`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at,
        ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${options.query})) as rank
      FROM memories
      ${whereClause}
      ORDER BY rank DESC, importance DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapMemory(row));
  }

  // ===========================================================================
  // Listing and Filtering
  // ===========================================================================

  async list(
    filters: MemoryListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<Memory>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [
      db`user_id = ${filters.userId}`,
      db`companion_id = ${filters.companionId}`,
    ];

    if (filters.contentType) {
      conditions.push(db`content_type = ${filters.contentType}`);
    }
    if (filters.status) {
      conditions.push(db`status = ${filters.status}`);
    } else {
      conditions.push(db`status = 'active'`);
    }
    if (filters.minImportance !== undefined) {
      conditions.push(db`importance >= ${filters.minImportance}`);
    }
    if (filters.tags && filters.tags.length > 0) {
      conditions.push(db`tags && ${filters.tags}`);
    }
    if (filters.dateRange?.from) {
      conditions.push(db`created_at >= ${filters.dateRange.from}`);
    }
    if (filters.dateRange?.to) {
      conditions.push(db`created_at < ${filters.dateRange.to}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at
      FROM memories
      ${whereClause}
      ORDER BY importance DESC, created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapMemory(row));

    return { data, hasMore };
  }

  /**
   * List memories for a user with optional filters (companionId is optional).
   * Returns paginated results with total count.
   */
  async listByUser(
    filters: UserMemoryListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<Memory>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [
      db`user_id = ${filters.userId}`,
    ];

    if (filters.companionId) {
      conditions.push(db`companion_id = ${filters.companionId}`);
    }
    if (filters.contentType) {
      conditions.push(db`content_type = ${filters.contentType}`);
    }
    if (filters.status) {
      conditions.push(db`status = ${filters.status}`);
    } else {
      conditions.push(db`status = 'active'`);
    }
    if (filters.minImportance !== undefined) {
      conditions.push(db`importance >= ${filters.minImportance}`);
    }
    if (filters.tags && filters.tags.length > 0) {
      conditions.push(db`tags && ${filters.tags}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    // Get total count and data in parallel
    const [countResult, result] = await Promise.all([
      db`SELECT COUNT(*)::int as count FROM memories ${whereClause}`,
      db`
        SELECT
          id, user_id, companion_id, content, content_type, status,
          importance, access_count, last_accessed_at,
          source_event_id, source_turn_id, metadata, tags,
          valid_from, valid_until, expires_at, created_at, updated_at
        FROM memories
        ${whereClause}
        ORDER BY importance DESC, created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
    ]);

    const total = countResult[0]?.['count'] as number ?? 0;
    const data = result.map(row => this.mapMemory(row));

    return { data, total, hasMore: offset + data.length < total, limit, offset };
  }

  /**
   * Soft-delete a memory by setting status to 'deleted'.
   * Returns the updated memory or null if not found / not owned by user.
   */
  async softDelete(
    id: string,
    userId: string,
    tx?: TransactionContext
  ): Promise<Memory | null> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE memories
      SET status = 'deleted', updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId} AND status != 'deleted'
      RETURNING
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at
    `;

    return result[0] ? this.mapMemory(result[0]) : null;
  }

  async getRecentMemories(
    userId: string,
    companionId: string,
    limit: number = 20,
    tx?: TransactionContext
  ): Promise<Memory[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at
      FROM memories
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapMemory(row));
  }

  async getImportantMemories(
    userId: string,
    companionId: string,
    limit: number = 20,
    tx?: TransactionContext
  ): Promise<Memory[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at
      FROM memories
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'active'
      ORDER BY importance DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapMemory(row));
  }

  // ===========================================================================
  // Access Tracking
  // ===========================================================================

  async recordAccess(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`SELECT record_memory_access(${id})`;
  }

  async recordAccessBatch(ids: string[], tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    for (const id of ids) {
      await db`SELECT record_memory_access(${id})`;
    }
  }

  // ===========================================================================
  // Memory Decay
  // ===========================================================================

  async applyDecay(
    userId: string,
    companionId: string,
    decayRate: number = 0.01,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT apply_memory_decay(${userId}, ${companionId}, ${decayRate}) as affected_count
    `;

    return result[0]?.['affected_count'] ?? 0;
  }

  async reinforceMemory(id: string, boost: number = 0.1, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE memories
      SET importance = LEAST(1.0, importance + ${boost})
      WHERE id = ${id}
    `;
  }

  // ===========================================================================
  // Expiration
  // ===========================================================================

  async deleteExpiredMemories(tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE memories
      SET status = 'deleted'
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      RETURNING id
    `;

    if (result.length > 0) {
      logger.info({ count: result.length }, 'Deleted expired memories');
    }

    return result.length;
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  async countByUser(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT COUNT(*)::int as count
      FROM memories
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'active'
    `;

    return result[0]?.['count'] ?? 0;
  }

  async getStatsByType(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Record<MemoryContentType, number>> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT content_type, COUNT(*)::int as count
      FROM memories
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'active'
      GROUP BY content_type
    `;

    const stats: Record<string, number> = {};
    for (const row of result) {
      stats[row['content_type'] as string] = row['count'] as number;
    }

    return stats as Record<MemoryContentType, number>;
  }

  // ===========================================================================
  // Pinned Memories
  // ===========================================================================

  /**
   * Get all pinned memories for a user-companion pair.
   * Pinned memories are always included in the context prompt.
   */
  async getPinnedMemories(
    userId: string,
    companionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<MemoryWithPinInfo[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, companion_id, content, content_type, status,
        importance, access_count, last_accessed_at,
        source_event_id, source_turn_id, metadata, tags,
        valid_from, valid_until, expires_at, created_at, updated_at,
        is_pinned, pin_order, pinned_at
      FROM memories
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND is_pinned = TRUE
        AND status = 'active'
      ORDER BY COALESCE(pin_order, 999), pinned_at ASC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapMemoryWithPinInfo(row));
  }

  /**
   * Pin a memory to always include it in context.
   * Returns false if the limit (10) is reached.
   */
  async pinMemory(
    memoryId: string,
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<boolean> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT pin_memory(${memoryId}, ${userId}, ${companionId}) as success
    `;

    return result[0]?.['success'] === true;
  }

  /**
   * Unpin a memory.
   */
  async unpinMemory(memoryId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`SELECT unpin_memory(${memoryId})`;
  }

  /**
   * Reorder pinned memories.
   * @param memoryIds - Array of memory IDs in the desired order
   */
  async reorderPinnedMemories(
    userId: string,
    companionId: string,
    memoryIds: string[],
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    await db`SELECT reorder_pinned_memories(${userId}, ${companionId}, ${memoryIds})`;
  }

  /**
   * Get count of pinned memories for a user-companion pair.
   */
  async getPinnedCount(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT COUNT(*)::int as count
      FROM memories
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND is_pinned = TRUE
        AND status = 'active'
    `;

    return result[0]?.['count'] ?? 0;
  }

  // ===========================================================================
  // Row Mapper
  // ===========================================================================

  private mapMemory(row: Record<string, unknown>): Memory {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      companion_id: row['companion_id'] as string,
      content: row['content'] as string,
      content_type: row['content_type'] as MemoryContentType,
      embedding: null, // We don't return the actual embedding
      importance: row['importance'] as number,
      source_event_id: row['source_event_id'] as string | null,
      source_turn_id: row['source_turn_id'] as string | null,
      metadata: row['metadata'] as JSONObject,
      expires_at: row['expires_at'] as Date | null,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapMemoryWithPinInfo(row: Record<string, unknown>): MemoryWithPinInfo {
    return {
      ...this.mapMemory(row),
      is_pinned: row['is_pinned'] as boolean,
      pin_order: row['pin_order'] as number | null,
      pinned_at: row['pinned_at'] as Date | null,
    };
  }
}

// Singleton instance
let memoriesRepositoryInstance: MemoriesRepository | null = null;

export function getMemoriesRepository(): MemoriesRepository {
  if (!memoriesRepositoryInstance) {
    memoriesRepositoryInstance = new MemoriesRepository();
  }
  return memoriesRepositoryInstance;
}
