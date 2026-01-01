/**
 * Tenets Service
 * Business logic for companion behavioral tenets (rules governing companion behavior).
 */

import { z } from 'zod';
import { getDb } from '../db/client.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const TenetCategorySchema = z.enum([
  'communication',
  'boundaries',
  'engagement',
  'emotional',
  'knowledge',
  'autonomy',
]);

export const TenetPrioritySchema = z.enum(['core', 'situational']);

export const CreateTenetInputSchema = z.object({
  category: TenetCategorySchema,
  priority: TenetPrioritySchema,
  rule: z.string().min(10).max(500),
  description: z.string().max(200).optional(),
  isNegation: z.boolean().default(false),
  triggerContexts: z.array(z.string()).optional(),
});

export const UpdateTenetInputSchema = z.object({
  category: TenetCategorySchema.optional(),
  priority: TenetPrioritySchema.optional(),
  rule: z.string().min(10).max(500).optional(),
  description: z.string().max(200).optional(),
  isNegation: z.boolean().optional(),
  triggerContexts: z.array(z.string()).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type TenetCategory = z.infer<typeof TenetCategorySchema>;
export type TenetPriority = z.infer<typeof TenetPrioritySchema>;
export type CreateTenetInput = z.infer<typeof CreateTenetInputSchema>;
export type UpdateTenetInput = z.infer<typeof UpdateTenetInputSchema>;

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
  createdAt: Date;
  updatedAt: Date;
}

export interface CoreTenet {
  id: string;
  category: TenetCategory;
  rule: string;
  isNegation: boolean;
}

export interface SituationalTenetMatch {
  id: string;
  category: TenetCategory;
  rule: string;
  isNegation: boolean;
  matchType: 'context' | 'semantic';
  similarity: number;
}

// ============================================================================
// Service
// ============================================================================

export class TenetsService {
  private db = getDb();

  /**
   * Create a new behavioral tenet
   */
  async create(
    userId: string,
    companionId: string,
    input: CreateTenetInput,
    tx?: TransactionContext
  ): Promise<Tenet> {
    const validated = CreateTenetInputSchema.parse(input);
    const sql = tx ?? this.db;

    // Enforce max 5 core tenets
    if (validated.priority === 'core') {
      const coreCount = await sql`
        SELECT COUNT(*) as count
        FROM behavioral_tenets
        WHERE companion_id = ${companionId}
          AND priority = 'core'
          AND is_active = TRUE
      `;

      if (Number(coreCount[0].count) >= 5) {
        throw new Error('Maximum of 5 core tenets allowed per companion');
      }
    }

    const result = await sql`
      INSERT INTO behavioral_tenets (
        companion_id,
        user_id,
        category,
        priority,
        rule,
        description,
        is_negation,
        trigger_contexts
      )
      VALUES (
        ${companionId},
        ${userId},
        ${validated.category},
        ${validated.priority},
        ${validated.rule},
        ${validated.description || null},
        ${validated.isNegation},
        ${validated.triggerContexts || []}
      )
      RETURNING *
    `;

    const tenet = this.mapRow(result[0]);
    logger.info(
      { userId, companionId, tenetId: tenet.id, priority: validated.priority },
      'Tenet created'
    );

    return tenet;
  }

  /**
   * Get all tenets for a companion
   */
  async list(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Tenet[]> {
    const sql = tx ?? this.db;

    const result = await sql`
      SELECT * FROM behavioral_tenets
      WHERE companion_id = ${companionId}
        AND user_id = ${userId}
        AND is_active = TRUE
      ORDER BY priority, category, created_at
    `;

    return result.map(this.mapRow);
  }

  /**
   * Get core tenets for system prompt inclusion
   */
  async getCoreTenets(
    companionId: string,
    tx?: TransactionContext
  ): Promise<CoreTenet[]> {
    const sql = tx ?? this.db;

    const result = await sql`
      SELECT id, category, rule, is_negation
      FROM behavioral_tenets
      WHERE companion_id = ${companionId}
        AND priority = 'core'
        AND is_active = TRUE
      ORDER BY category, created_at
    `;

    return result.map((row) => ({
      id: row.id,
      category: row.category as TenetCategory,
      rule: row.rule,
      isNegation: row.is_negation,
    }));
  }

  /**
   * Search situational tenets by context and/or semantic similarity
   */
  async searchSituational(
    companionId: string,
    contexts: string[] = [],
    queryEmbedding?: number[],
    limit: number = 5,
    tx?: TransactionContext
  ): Promise<SituationalTenetMatch[]> {
    const sql = tx ?? this.db;

    // If we have an embedding, use the full search function
    if (queryEmbedding) {
      const result = await sql`
        SELECT * FROM search_situational_tenets(
          ${companionId},
          ${JSON.stringify(queryEmbedding)}::vector,
          ${contexts},
          ${limit}
        )
      `;

      return result.map((row) => ({
        id: row.id,
        category: row.category as TenetCategory,
        rule: row.rule,
        isNegation: row.is_negation,
        matchType: row.match_type as 'context' | 'semantic',
        similarity: row.similarity,
      }));
    }

    // Otherwise, just match by context
    if (contexts.length === 0) {
      return [];
    }

    const result = await sql`
      SELECT id, category, rule, is_negation, 'context' as match_type, 1.0 as similarity
      FROM behavioral_tenets
      WHERE companion_id = ${companionId}
        AND priority = 'situational'
        AND is_active = TRUE
        AND trigger_contexts && ${contexts}
      ORDER BY created_at
      LIMIT ${limit}
    `;

    return result.map((row) => ({
      id: row.id,
      category: row.category as TenetCategory,
      rule: row.rule,
      isNegation: row.is_negation,
      matchType: 'context',
      similarity: 1.0,
    }));
  }

  /**
   * Update a tenet
   */
  async update(
    userId: string,
    companionId: string,
    tenetId: string,
    input: UpdateTenetInput,
    tx?: TransactionContext
  ): Promise<Tenet> {
    const validated = UpdateTenetInputSchema.parse(input);
    const sql = tx ?? this.db;

    // Check ownership
    const existing = await sql`
      SELECT * FROM behavioral_tenets
      WHERE id = ${tenetId}
        AND companion_id = ${companionId}
        AND user_id = ${userId}
        AND is_active = TRUE
    `;

    if (existing.length === 0) {
      throw new Error('Tenet not found');
    }

    // If changing to core, check limit
    if (validated.priority === 'core' && existing[0].priority !== 'core') {
      const coreCount = await sql`
        SELECT COUNT(*) as count
        FROM behavioral_tenets
        WHERE companion_id = ${companionId}
          AND priority = 'core'
          AND is_active = TRUE
          AND id != ${tenetId}
      `;

      if (Number(coreCount[0].count) >= 5) {
        throw new Error('Maximum of 5 core tenets allowed per companion');
      }
    }

    const result = await sql`
      UPDATE behavioral_tenets
      SET
        category = COALESCE(${validated.category ?? null}, category),
        priority = COALESCE(${validated.priority ?? null}, priority),
        rule = COALESCE(${validated.rule ?? null}, rule),
        description = COALESCE(${validated.description ?? null}, description),
        is_negation = COALESCE(${validated.isNegation ?? null}, is_negation),
        trigger_contexts = COALESCE(${validated.triggerContexts ?? null}, trigger_contexts),
        updated_at = NOW()
      WHERE id = ${tenetId}
        AND companion_id = ${companionId}
        AND user_id = ${userId}
      RETURNING *
    `;

    const tenet = this.mapRow(result[0]);
    logger.debug({ userId, companionId, tenetId }, 'Tenet updated');

    return tenet;
  }

  /**
   * Update tenet priority
   */
  async updatePriority(
    userId: string,
    companionId: string,
    tenetId: string,
    priority: TenetPriority,
    tx?: TransactionContext
  ): Promise<Tenet> {
    return this.update(userId, companionId, tenetId, { priority }, tx);
  }

  /**
   * Soft delete a tenet
   */
  async delete(
    userId: string,
    companionId: string,
    tenetId: string,
    tx?: TransactionContext
  ): Promise<void> {
    const sql = tx ?? this.db;

    const result = await sql`
      UPDATE behavioral_tenets
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = ${tenetId}
        AND companion_id = ${companionId}
        AND user_id = ${userId}
        AND is_active = TRUE
      RETURNING id
    `;

    if (result.length === 0) {
      throw new Error('Tenet not found');
    }

    logger.info({ userId, companionId, tenetId }, 'Tenet deleted');
  }

  /**
   * Bulk create tenets (for onboarding)
   */
  async bulkCreate(
    userId: string,
    companionId: string,
    tenets: CreateTenetInput[],
    tx?: TransactionContext
  ): Promise<Tenet[]> {
    const sql = tx ?? this.db;

    // Validate all inputs first
    const validatedTenets = tenets.map((t) => CreateTenetInputSchema.parse(t));

    // Check core tenet limit
    const coreTenets = validatedTenets.filter((t) => t.priority === 'core');
    if (coreTenets.length > 5) {
      throw new Error('Maximum of 5 core tenets allowed per companion');
    }

    const results: Tenet[] = [];
    for (const validated of validatedTenets) {
      const result = await sql`
        INSERT INTO behavioral_tenets (
          companion_id,
          user_id,
          category,
          priority,
          rule,
          description,
          is_negation,
          trigger_contexts
        )
        VALUES (
          ${companionId},
          ${userId},
          ${validated.category},
          ${validated.priority},
          ${validated.rule},
          ${validated.description || null},
          ${validated.isNegation},
          ${validated.triggerContexts || []}
        )
        RETURNING *
      `;

      results.push(this.mapRow(result[0]));
    }

    logger.info(
      { userId, companionId, count: results.length },
      'Bulk tenets created'
    );

    return results;
  }

  /**
   * Map database row to Tenet object
   */
  private mapRow(row: Record<string, unknown>): Tenet {
    return {
      id: row.id as string,
      companionId: row.companion_id as string,
      userId: row.user_id as string,
      category: row.category as TenetCategory,
      priority: row.priority as TenetPriority,
      rule: row.rule as string,
      description: row.description as string | null,
      isNegation: row.is_negation as boolean,
      triggerContexts: row.trigger_contexts as string[],
      isActive: row.is_active as boolean,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}

// Singleton instance
let tenetsService: TenetsService | null = null;

export function getTenetsService(): TenetsService {
  if (!tenetsService) {
    tenetsService = new TenetsService();
  }
  return tenetsService;
}
