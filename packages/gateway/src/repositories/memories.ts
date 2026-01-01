/**
 * Memories Repository
 * Data access for memories table with vector search support
 */

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
          ${data.metadata ?? {}},
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
        metadata = COALESCE(${data.metadata ?? null}, metadata),
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
    const db = this.getSql(tx);
    const limit = options.limit ?? 10;
    const minSimilarity = options.minSimilarity ?? 0.7;
    const embeddingValue = `[${options.embedding.join(',')}]`;

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
}

// Singleton instance
let memoriesRepositoryInstance: MemoriesRepository | null = null;

export function getMemoriesRepository(): MemoriesRepository {
  if (!memoriesRepositoryInstance) {
    memoriesRepositoryInstance = new MemoriesRepository();
  }
  return memoriesRepositoryInstance;
}
