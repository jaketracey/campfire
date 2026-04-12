/**
 * Memory Documents Repository
 * Data access for companion_memory_documents table (Karpathy-style LLM memory).
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext } from './types.js';

/**
 * Memory document row from database.
 */
export interface MemoryDocument {
  id: string;
  user_id: string;
  companion_id: string;
  content: string;
  version: number;
  last_compiled_at: Date | null;
  last_compiled_turn_id: string | null;
  compilation_count: number;
  estimated_tokens: number;
  created_at: Date;
  updated_at: Date;
}

export class MemoryDocumentsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Get the content and version for a user-companion pair.
   */
  async getContent(
    userId: string,
    companionId: string,
    tx?: TransactionContext,
  ): Promise<{ content: string; version: number } | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT content, version
      FROM companion_memory_documents
      WHERE user_id = ${userId} AND companion_id = ${companionId}
    `;

    if (!result[0]) return null;

    return {
      content: result[0]['content'] as string,
      version: result[0]['version'] as number,
    };
  }

  /**
   * Get or create a memory document for a user-companion pair.
   */
  async getOrCreate(
    userId: string,
    companionId: string,
    tx?: TransactionContext,
  ): Promise<MemoryDocument> {
    const db = this.getSql(tx);

    await db`
      INSERT INTO companion_memory_documents (user_id, companion_id)
      VALUES (${userId}, ${companionId})
      ON CONFLICT (user_id, companion_id) DO NOTHING
    `;

    const result = await db`
      SELECT
        id, user_id, companion_id, content, version,
        last_compiled_at, last_compiled_turn_id,
        compilation_count, estimated_tokens,
        created_at, updated_at
      FROM companion_memory_documents
      WHERE user_id = ${userId} AND companion_id = ${companionId}
    `;

    return this.mapRow(result[0]!);
  }

  /**
   * Update the content with optimistic locking (version check).
   * Returns true if the update succeeded.
   */
  async updateContent(
    userId: string,
    companionId: string,
    content: string,
    estimatedTokens: number,
    expectedVersion: number,
    turnId?: string,
    tx?: TransactionContext,
  ): Promise<boolean> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE companion_memory_documents
      SET
        content = ${content},
        estimated_tokens = ${estimatedTokens},
        version = version + 1,
        last_compiled_at = NOW(),
        last_compiled_turn_id = ${turnId ?? null},
        compilation_count = compilation_count + 1
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND version = ${expectedVersion}
    `;

    return result.count > 0;
  }

  /**
   * Upsert: insert or update content (for first-write scenarios).
   */
  async upsertContent(
    userId: string,
    companionId: string,
    content: string,
    estimatedTokens: number,
    turnId?: string,
    tx?: TransactionContext,
  ): Promise<void> {
    const db = this.getSql(tx);

    await db`
      INSERT INTO companion_memory_documents (
        user_id, companion_id, content, estimated_tokens,
        last_compiled_at, last_compiled_turn_id, compilation_count
      ) VALUES (
        ${userId}, ${companionId}, ${content}, ${estimatedTokens},
        NOW(), ${turnId ?? null}, 1
      )
      ON CONFLICT (user_id, companion_id) DO UPDATE SET
        content = EXCLUDED.content,
        estimated_tokens = EXCLUDED.estimated_tokens,
        version = companion_memory_documents.version + 1,
        last_compiled_at = NOW(),
        last_compiled_turn_id = EXCLUDED.last_compiled_turn_id,
        compilation_count = companion_memory_documents.compilation_count + 1
    `;
  }

  private mapRow(row: Record<string, unknown>): MemoryDocument {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      companion_id: row['companion_id'] as string,
      content: row['content'] as string,
      version: row['version'] as number,
      last_compiled_at: row['last_compiled_at'] as Date | null,
      last_compiled_turn_id: row['last_compiled_turn_id'] as string | null,
      compilation_count: row['compilation_count'] as number,
      estimated_tokens: row['estimated_tokens'] as number,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }
}

// Singleton instance
let memoryDocumentsRepositoryInstance: MemoryDocumentsRepository | null = null;

export function getMemoryDocumentsRepository(): MemoryDocumentsRepository {
  if (!memoryDocumentsRepositoryInstance) {
    memoryDocumentsRepositoryInstance = new MemoryDocumentsRepository();
  }
  return memoryDocumentsRepositoryInstance;
}
