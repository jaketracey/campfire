/**
 * Memories Service
 * Business logic for long-term memory management with vector search.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  getMemoriesRepository,
  getCompanionsRepository,
  type MemorySearchResult,
  type MemoryListFilters,
  type MemoryStats,
  type PaginatedResult,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';
import type { Memory, MemoryInsert, MemoryContentType, JSONObject } from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const CreateMemoryInputSchema = z.object({
  companionId: z.string().uuid(),
  content: z.string().min(1).max(10000),
  contentType: z.enum(['fact', 'preference', 'event', 'summary', 'reflection']).optional(),
  importance: z.number().min(0).max(1).optional(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.date().optional(),
  sourceEventId: z.string().uuid().optional(),
  sourceTurnId: z.string().uuid().optional(),
});

export const UpdateMemoryInputSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.date().optional().nullable(),
});

export const SearchMemoriesInputSchema = z.object({
  companionId: z.string().uuid(),
  query: z.string().min(1).max(1000).optional(),
  embedding: z.array(z.number()).optional(),
  contentTypes: z.array(z.enum(['fact', 'preference', 'event', 'summary', 'reflection'])).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type CreateMemoryInput = z.infer<typeof CreateMemoryInputSchema>;
export type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;
export type SearchMemoriesInput = z.infer<typeof SearchMemoriesInputSchema>;

export interface MemoryWithRelevance extends Memory {
  relevanceScore: number;
  distance?: number;
}

export interface MemoryContext {
  memories: MemoryWithRelevance[];
  totalCount: number;
  importanceRange: { min: number; max: number };
}

export interface MemoryCluster {
  topic: string;
  memories: Memory[];
  avgImportance: number;
}

// ============================================================================
// Service
// ============================================================================

export class MemoriesService {
  private memories = getMemoriesRepository();
  private companions = getCompanionsRepository();
  private events = getEventsService();

  // Default embedding dimension for Ada-002
  private readonly EMBEDDING_DIMENSION = 1536;
  // Default memory decay rate per day
  private readonly DECAY_RATE = 0.01;

  /**
   * Create a new memory
   */
  async create(
    userId: string,
    input: CreateMemoryInput,
    tx?: TransactionContext
  ): Promise<Memory> {
    const validated = CreateMemoryInputSchema.parse(input);

    // Verify companion belongs to user
    const companion = await this.companions.findById(validated.companionId, tx);
    if (!companion || companion.user_id !== userId) {
      throw new Error('Companion not found');
    }

    // Check memory consent
    if (!companion.spec.memory_consent.allow_long_term) {
      throw new Error('Long-term memory is disabled for this companion');
    }

    // Calculate expiration if retention is set
    let expiresAt = validated.expiresAt;
    if (!expiresAt && companion.spec.memory_consent.retention_days) {
      expiresAt = new Date(Date.now() + companion.spec.memory_consent.retention_days * 24 * 60 * 60 * 1000);
    }

    // Create the memory
    const memory = await this.memories.create({
      user_id: userId,
      companion_id: validated.companionId,
      content: validated.content,
      content_type: validated.contentType as MemoryContentType,
      embedding: validated.embedding,
      importance: validated.importance ?? 0.5,
      source_event_id: validated.sourceEventId,
      source_turn_id: validated.sourceTurnId,
      metadata: (validated.metadata ?? {}) as JSONObject,
      expires_at: expiresAt,
    }, tx);

    // Emit memory written event
    const context: EventContext = {
      userId,
      sessionId: validated.sourceTurnId ?? 'memory-creation',
      turnId: validated.sourceTurnId,
      traceId: crypto.randomUUID(),
    };

    await this.events.emitMemoryWritten(context, {
      memoryId: memory.id,
      content: memory.content,
      contentType: memory.content_type,
      importance: memory.importance,
    });

    logger.debug(
      { userId, companionId: validated.companionId, memoryId: memory.id },
      'Memory created'
    );

    return memory;
  }

  /**
   * Get a memory by ID
   */
  async getById(
    userId: string,
    memoryId: string,
    tx?: TransactionContext
  ): Promise<Memory | null> {
    const memory = await this.memories.findById(memoryId, tx);

    // Verify ownership
    if (memory && memory.user_id !== userId) {
      return null;
    }

    // Record access
    if (memory) {
      await this.memories.recordAccess(memoryId, tx);
    }

    return memory;
  }

  /**
   * Update a memory
   */
  async update(
    userId: string,
    memoryId: string,
    input: UpdateMemoryInput,
    tx?: TransactionContext
  ): Promise<Memory> {
    const validated = UpdateMemoryInputSchema.parse(input);

    const memory = await this.getById(userId, memoryId, tx);
    if (!memory) {
      throw new Error('Memory not found');
    }

    const updated = await this.memories.update(memoryId, {
      content: validated.content,
      importance: validated.importance,
      metadata: validated.metadata as JSONObject,
      expires_at: validated.expiresAt,
    }, tx);

    logger.debug({ memoryId }, 'Memory updated');
    return updated;
  }

  /**
   * Update memory embedding
   */
  async updateEmbedding(
    userId: string,
    memoryId: string,
    embedding: number[],
    tx?: TransactionContext
  ): Promise<Memory> {
    const memory = await this.getById(userId, memoryId, tx);
    if (!memory) {
      throw new Error('Memory not found');
    }

    if (embedding.length !== this.EMBEDDING_DIMENSION) {
      throw new Error(`Embedding must have ${this.EMBEDDING_DIMENSION} dimensions`);
    }

    return this.memories.updateEmbedding(memoryId, embedding, tx);
  }

  /**
   * Archive a memory (soft delete)
   */
  async archive(
    userId: string,
    memoryId: string,
    tx?: TransactionContext
  ): Promise<void> {
    const memory = await this.getById(userId, memoryId, tx);
    if (!memory) {
      throw new Error('Memory not found');
    }

    await this.memories.archive(memoryId, tx);

    // Emit memory deleted event
    const context: EventContext = {
      userId,
      sessionId: 'memory-management',
      traceId: crypto.randomUUID(),
    };

    await this.events.emitMemoryDeleted(context, {
      memoryId,
      reason: 'user_archived',
    });

    logger.debug({ memoryId }, 'Memory archived');
  }

  /**
   * Permanently delete a memory
   */
  async delete(
    userId: string,
    memoryId: string,
    tx?: TransactionContext
  ): Promise<void> {
    const memory = await this.getById(userId, memoryId, tx);
    if (!memory) {
      throw new Error('Memory not found');
    }

    await this.memories.hardDelete(memoryId, tx);

    // Emit memory deleted event
    const context: EventContext = {
      userId,
      sessionId: 'memory-management',
      traceId: crypto.randomUUID(),
    };

    await this.events.emitMemoryDeleted(context, {
      memoryId,
      reason: 'user_deleted',
    });

    logger.debug({ memoryId }, 'Memory permanently deleted');
  }

  /**
   * Search memories by vector similarity
   */
  async searchByVector(
    userId: string,
    input: SearchMemoriesInput,
    tx?: TransactionContext
  ): Promise<MemorySearchResult[]> {
    const validated = SearchMemoriesInputSchema.parse(input);

    if (!validated.embedding) {
      throw new Error('Embedding is required for vector search');
    }

    // Verify companion ownership
    const companion = await this.companions.findById(validated.companionId, tx);
    if (!companion || companion.user_id !== userId) {
      throw new Error('Companion not found');
    }

    const results = await this.memories.searchByVector(
      userId,
      validated.companionId,
      validated.embedding,
      {
        limit: validated.limit ?? 20,
        minImportance: validated.minImportance,
        contentTypes: validated.contentTypes,
      },
      tx
    );

    // Record access for returned memories
    if (results.length > 0) {
      await this.memories.recordAccessBatch(
        results.map(r => r.memory.id),
        tx
      );
    }

    return results;
  }

  /**
   * Search memories by text (full-text search)
   */
  async searchByText(
    userId: string,
    companionId: string,
    query: string,
    options: { limit?: number; minImportance?: number } = {},
    tx?: TransactionContext
  ): Promise<Memory[]> {
    // Verify companion ownership
    const companion = await this.companions.findById(companionId, tx);
    if (!companion || companion.user_id !== userId) {
      throw new Error('Companion not found');
    }

    return this.memories.searchByText(
      userId,
      companionId,
      query,
      options.limit ?? 20,
      tx
    );
  }

  /**
   * Get memory context for a conversation
   * Returns relevant memories based on query embedding and conversation history
   */
  async getContextMemories(
    userId: string,
    companionId: string,
    queryEmbedding: number[],
    options: {
      limit?: number;
      minImportance?: number;
      includeRecent?: boolean;
    } = {},
    tx?: TransactionContext
  ): Promise<MemoryContext> {
    const limit = options.limit ?? 10;

    // Get vector search results
    const searchResults = await this.memories.searchByVector(
      userId,
      companionId,
      queryEmbedding,
      { limit, minImportance: options.minImportance },
      tx
    );

    // Optionally include recent memories
    let recentMemories: Memory[] = [];
    if (options.includeRecent) {
      recentMemories = await this.memories.getRecentMemories(userId, companionId, 5, tx);
    }

    // Merge and deduplicate
    const memoryMap = new Map<string, MemoryWithRelevance>();

    for (const result of searchResults) {
      memoryMap.set(result.memory.id, {
        ...result.memory,
        relevanceScore: result.similarity,
        distance: result.distance,
      });
    }

    for (const memory of recentMemories) {
      if (!memoryMap.has(memory.id)) {
        memoryMap.set(memory.id, {
          ...memory,
          relevanceScore: 0.5, // Base relevance for recent memories
        });
      }
    }

    const memories = Array.from(memoryMap.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    // Calculate importance range
    const importances = memories.map(m => m.importance);
    const minImportance = Math.min(...importances, 1);
    const maxImportance = Math.max(...importances, 0);

    // Get total count
    const totalCount = await this.memories.countByUser(userId, companionId, tx);

    return {
      memories,
      totalCount,
      importanceRange: { min: minImportance, max: maxImportance },
    };
  }

  /**
   * List memories for a companion
   */
  async list(
    userId: string,
    filters: Omit<MemoryListFilters, 'userId'>,
    tx?: TransactionContext
  ): Promise<PaginatedResult<Memory>> {
    // Verify companion ownership if specified
    if (filters.companionId) {
      const companion = await this.companions.findById(filters.companionId, tx);
      if (!companion || companion.user_id !== userId) {
        throw new Error('Companion not found');
      }
    }

    return this.memories.list({ ...filters, userId }, tx);
  }

  /**
   * Get important memories
   */
  async getImportantMemories(
    userId: string,
    companionId: string,
    minImportance: number = 0.7,
    limit: number = 20,
    tx?: TransactionContext
  ): Promise<Memory[]> {
    return this.memories.getImportantMemories(userId, companionId, minImportance, limit, tx);
  }

  /**
   * Reinforce a memory (increase importance due to relevance)
   */
  async reinforce(
    userId: string,
    memoryId: string,
    amount: number = 0.1,
    tx?: TransactionContext
  ): Promise<Memory> {
    const memory = await this.getById(userId, memoryId, tx);
    if (!memory) {
      throw new Error('Memory not found');
    }

    return this.memories.reinforceMemory(memoryId, amount, tx);
  }

  /**
   * Apply decay to old memories (background job)
   */
  async applyDecay(tx?: TransactionContext): Promise<number> {
    const count = await this.memories.applyDecay(this.DECAY_RATE, tx);

    if (count > 0) {
      logger.debug({ count, decayRate: this.DECAY_RATE }, 'Applied memory decay');
    }

    return count;
  }

  /**
   * Clean up expired memories (background job)
   */
  async cleanupExpired(tx?: TransactionContext): Promise<number> {
    const count = await this.memories.deleteExpiredMemories(tx);

    if (count > 0) {
      logger.info({ count }, 'Deleted expired memories');
    }

    return count;
  }

  /**
   * Get memory statistics
   */
  async getStats(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<MemoryStats[]> {
    return this.memories.getStatsByType(userId, companionId, tx);
  }

  /**
   * Count memories
   */
  async count(
    userId: string,
    companionId?: string,
    tx?: TransactionContext
  ): Promise<number> {
    return this.memories.countByUser(userId, companionId, tx);
  }

  /**
   * Bulk import memories (for data import)
   */
  async bulkImport(
    userId: string,
    companionId: string,
    memories: Array<Omit<CreateMemoryInput, 'companionId'>>,
    tx?: TransactionContext
  ): Promise<Memory[]> {
    // Verify companion ownership
    const companion = await this.companions.findById(companionId, tx);
    if (!companion || companion.user_id !== userId) {
      throw new Error('Companion not found');
    }

    const results: Memory[] = [];

    for (const memoryInput of memories) {
      const memory = await this.create(
        userId,
        { ...memoryInput, companionId },
        tx
      );
      results.push(memory);
    }

    logger.info(
      { userId, companionId, count: results.length },
      'Bulk imported memories'
    );

    return results;
  }

  /**
   * Export all memories for a companion
   */
  async export(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Memory[]> {
    const allMemories: Memory[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const result = await this.list(userId, { companionId, limit, offset }, tx);
      allMemories.push(...result.data);

      if (!result.hasMore) break;
      offset += limit;
    }

    return allMemories;
  }

  /**
   * Get event context for memory operations
   */
  getEventContext(userId: string, sessionId?: string, turnId?: string): EventContext {
    return this.events.createContextFromRequest(userId, sessionId ?? 'memory-management', turnId);
  }
}

// Singleton instance
let memoriesService: MemoriesService | null = null;

export function getMemoriesService(): MemoriesService {
  if (!memoriesService) {
    memoriesService = new MemoriesService();
  }
  return memoriesService;
}
