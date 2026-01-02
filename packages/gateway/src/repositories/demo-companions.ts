/**
 * Demo Companions Repository
 * Data access for demo_companions table (companions available for anonymous trials)
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError, validateUuid } from './errors.js';

/**
 * Demo companion record
 */
export interface DemoCompanion {
  id: string;
  companion_id: string;
  is_active: boolean;
  display_order: number;
  created_at: Date;
}

/**
 * Demo companion with full companion details
 */
export interface DemoCompanionWithDetails extends DemoCompanion {
  companion_name: string;
  companion_avatar_url: string | null;
  companion_status: string;
}

/**
 * Insert type for demo companion
 */
export interface DemoCompanionInsert {
  companion_id: string;
  is_active?: boolean;
  display_order?: number;
}

export class DemoCompanionsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  /**
   * Find a demo companion by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<DemoCompanion | null> {
    validateUuid(id, 'demoCompanion.id');
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, companion_id, is_active, display_order, created_at
      FROM demo_companions
      WHERE id = ${id}
    `;

    return result[0] ? this.mapDemoCompanion(result[0]) : null;
  }

  /**
   * Find a demo companion by companion ID
   */
  async findByCompanionId(companionId: string, tx?: TransactionContext): Promise<DemoCompanion | null> {
    validateUuid(companionId, 'companion.id');
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, companion_id, is_active, display_order, created_at
      FROM demo_companions
      WHERE companion_id = ${companionId}
    `;

    return result[0] ? this.mapDemoCompanion(result[0]) : null;
  }

  /**
   * Get a random active demo companion with full details
   */
  async getRandomActive(tx?: TransactionContext): Promise<DemoCompanionWithDetails | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        dc.id,
        dc.companion_id,
        dc.is_active,
        dc.display_order,
        dc.created_at,
        c.name as companion_name,
        ca.asset_url as companion_avatar_url,
        c.status as companion_status
      FROM demo_companions dc
      JOIN companions c ON dc.companion_id = c.id
      LEFT JOIN companion_avatars ca ON c.active_avatar_id = ca.id
      WHERE dc.is_active = TRUE AND c.status = 'active'
      ORDER BY RANDOM()
      LIMIT 1
    `;

    return result[0] ? this.mapDemoCompanionWithDetails(result[0]) : null;
  }

  /**
   * List all demo companions with details
   */
  async listWithDetails(
    options: PaginationOptions & { activeOnly?: boolean } = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<DemoCompanionWithDetails>> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const activeOnly = options.activeOnly ?? false;

    const conditions: ReturnType<typeof db>[] = [];
    if (activeOnly) {
      conditions.push(db`dc.is_active = TRUE`);
    }

    const whereClause = conditions.length > 0
      ? db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`
      : db``;

    const result = await db`
      SELECT
        dc.id,
        dc.companion_id,
        dc.is_active,
        dc.display_order,
        dc.created_at,
        c.name as companion_name,
        ca.asset_url as companion_avatar_url,
        c.status as companion_status
      FROM demo_companions dc
      JOIN companions c ON dc.companion_id = c.id
      LEFT JOIN companion_avatars ca ON c.active_avatar_id = ca.id
      ${whereClause}
      ORDER BY dc.display_order ASC, dc.created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapDemoCompanionWithDetails(row));

    return { data, hasMore };
  }

  /**
   * List active demo companions (simple list)
   */
  async listActive(tx?: TransactionContext): Promise<DemoCompanion[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT dc.id, dc.companion_id, dc.is_active, dc.display_order, dc.created_at
      FROM demo_companions dc
      JOIN companions c ON dc.companion_id = c.id
      WHERE dc.is_active = TRUE AND c.status = 'active'
      ORDER BY dc.display_order ASC
    `;

    return result.map(row => this.mapDemoCompanion(row));
  }

  /**
   * Add a companion to the demo list
   */
  async create(data: DemoCompanionInsert, tx?: TransactionContext): Promise<DemoCompanion> {
    validateUuid(data.companion_id, 'companion.id');
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO demo_companions (companion_id, is_active, display_order)
        VALUES (
          ${data.companion_id},
          ${data.is_active ?? true},
          ${data.display_order ?? 0}
        )
        RETURNING id, companion_id, is_active, display_order, created_at
      `;

      const demoCompanion = this.mapDemoCompanion(result[0]!);
      logger.debug({ demoCompanionId: demoCompanion.id, companionId: data.companion_id }, 'Demo companion added');
      return demoCompanion;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('DemoCompanion', 'companion_id', data.companion_id);
      }
      throw wrapDatabaseError(error, 'demoCompanions.create');
    }
  }

  /**
   * Update a demo companion
   */
  async update(
    id: string,
    data: Partial<Omit<DemoCompanionInsert, 'companion_id'>>,
    tx?: TransactionContext
  ): Promise<DemoCompanion> {
    validateUuid(id, 'demoCompanion.id');
    const db = this.getSql(tx);

    const result = await db`
      UPDATE demo_companions
      SET
        is_active = COALESCE(${data.is_active ?? null}, is_active),
        display_order = COALESCE(${data.display_order ?? null}, display_order)
      WHERE id = ${id}
      RETURNING id, companion_id, is_active, display_order, created_at
    `;

    if (!result[0]) {
      throw new NotFoundError('DemoCompanion', id);
    }

    return this.mapDemoCompanion(result[0]);
  }

  /**
   * Remove a companion from the demo list
   */
  async delete(id: string, tx?: TransactionContext): Promise<void> {
    validateUuid(id, 'demoCompanion.id');
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM demo_companions
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('DemoCompanion', id);
    }

    logger.debug({ demoCompanionId: id }, 'Demo companion removed');
  }

  /**
   * Count active demo companions
   */
  async countActive(tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT COUNT(*)::int as count
      FROM demo_companions dc
      JOIN companions c ON dc.companion_id = c.id
      WHERE dc.is_active = TRUE AND c.status = 'active'
    `;

    return result[0]?.['count'] ?? 0;
  }

  // ===========================================================================
  // Aliased Methods (required by spec)
  // ===========================================================================

  /**
   * Get all active demo companions with details, ordered by display_order
   * Alias for listWithDetails({ activeOnly: true })
   */
  async getActive(tx?: TransactionContext): Promise<DemoCompanionWithDetails[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        dc.id,
        dc.companion_id,
        dc.is_active,
        dc.display_order,
        dc.created_at,
        c.name as companion_name,
        ca.asset_url as companion_avatar_url,
        c.status as companion_status
      FROM demo_companions dc
      JOIN companions c ON dc.companion_id = c.id
      LEFT JOIN companion_avatars ca ON ca.companion_id = c.id AND ca.is_active = TRUE
      WHERE dc.is_active = TRUE AND c.status = 'active'
      ORDER BY dc.display_order ASC
    `;

    return result.map(row => this.mapDemoCompanionWithDetails(row));
  }

  /**
   * Get a random active demo companion with full details
   * Alias for getRandomActive
   */
  async getRandom(tx?: TransactionContext): Promise<DemoCompanionWithDetails | null> {
    return this.getRandomActive(tx);
  }

  /**
   * Add a companion to the demo list with auto-incrementing display_order
   */
  async add(data: DemoCompanionInsert, tx?: TransactionContext): Promise<DemoCompanion> {
    validateUuid(data.companion_id, 'companion.id');
    const db = this.getSql(tx);

    try {
      // Get max display_order if not provided
      let displayOrder = data.display_order;
      if (displayOrder === undefined) {
        const maxResult = await db`
          SELECT COALESCE(MAX(display_order), -1) + 1 as next_order
          FROM demo_companions
        `;
        displayOrder = maxResult[0]?.['next_order'] as number ?? 0;
      }

      const result = await db`
        INSERT INTO demo_companions (companion_id, is_active, display_order)
        VALUES (
          ${data.companion_id},
          ${data.is_active ?? true},
          ${displayOrder}
        )
        RETURNING id, companion_id, is_active, display_order, created_at
      `;

      const demoCompanion = this.mapDemoCompanion(result[0]!);
      logger.info({ demoCompanionId: demoCompanion.id, companionId: data.companion_id }, 'Demo companion added');
      return demoCompanion;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('DemoCompanion', 'companion_id', data.companion_id);
      }
      throw wrapDatabaseError(error, 'demoCompanions.add');
    }
  }

  /**
   * Remove a companion from the demo list by companion ID
   */
  async remove(companionId: string, tx?: TransactionContext): Promise<void> {
    validateUuid(companionId, 'companion.id');
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM demo_companions
      WHERE companion_id = ${companionId}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('DemoCompanion', companionId);
    }

    logger.info({ companionId }, 'Demo companion removed');
  }

  /**
   * Reorder demo companions
   * @param orderedCompanionIds Array of companion IDs in desired order
   */
  async reorder(orderedCompanionIds: string[], tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    // Update display_order for each companion based on array position
    for (let i = 0; i < orderedCompanionIds.length; i++) {
      await db`
        UPDATE demo_companions
        SET display_order = ${i}
        WHERE companion_id = ${orderedCompanionIds[i]}
      `;
    }

    logger.info({ count: orderedCompanionIds.length }, 'Demo companions reordered');
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapDemoCompanion(row: Record<string, unknown>): DemoCompanion {
    return {
      id: row['id'] as string,
      companion_id: row['companion_id'] as string,
      is_active: row['is_active'] as boolean,
      display_order: row['display_order'] as number,
      created_at: row['created_at'] as Date,
    };
  }

  private mapDemoCompanionWithDetails(row: Record<string, unknown>): DemoCompanionWithDetails {
    return {
      id: row['id'] as string,
      companion_id: row['companion_id'] as string,
      is_active: row['is_active'] as boolean,
      display_order: row['display_order'] as number,
      created_at: row['created_at'] as Date,
      companion_name: row['companion_name'] as string,
      companion_avatar_url: row['companion_avatar_url'] as string | null,
      companion_status: row['companion_status'] as string,
    };
  }
}

// Singleton instance
let demoCompanionsRepositoryInstance: DemoCompanionsRepository | null = null;

export function getDemoCompanionsRepository(): DemoCompanionsRepository {
  if (!demoCompanionsRepositoryInstance) {
    demoCompanionsRepositoryInstance = new DemoCompanionsRepository();
  }
  return demoCompanionsRepositoryInstance;
}
