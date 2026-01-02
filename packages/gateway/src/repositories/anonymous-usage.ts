/**
 * Anonymous Usage Repository
 * Data access for anonymous_usage table (tracking anonymous user trial sessions)
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { UUID, Timestamp } from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export interface AnonymousUsage {
  id: UUID;
  device_fingerprint: string;
  ip_address: string | null;
  messages_used: number;
  last_session_id: UUID | null;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  converted_user_id: UUID | null;
}

export interface AnonymousUsageInsert {
  device_fingerprint: string;
  ip_address?: string | null;
  messages_used?: number;
  last_session_id?: UUID | null;
}

export interface AnonymousUsageListFilters extends PaginationOptions {
  /** Only converted users */
  converted?: boolean;
  /** Only unconverted users */
  unconverted?: boolean;
}

// ============================================================================
// Repository
// ============================================================================

export class AnonymousUsageRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Core Operations
  // ===========================================================================

  /**
   * Get usage record by device fingerprint
   */
  async getByFingerprint(
    fingerprint: string,
    tx?: TransactionContext
  ): Promise<AnonymousUsage | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, device_fingerprint, ip_address, messages_used,
             last_session_id, first_seen_at, last_seen_at, converted_user_id
      FROM anonymous_usage
      WHERE device_fingerprint = ${fingerprint}
    `;

    return result[0] ? this.mapAnonymousUsage(result[0]) : null;
  }

  /**
   * Get usage record by ID
   */
  async getById(id: string, tx?: TransactionContext): Promise<AnonymousUsage | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT id, device_fingerprint, ip_address, messages_used,
             last_session_id, first_seen_at, last_seen_at, converted_user_id
      FROM anonymous_usage
      WHERE id = ${id}
    `;

    return result[0] ? this.mapAnonymousUsage(result[0]) : null;
  }

  /**
   * Create a new usage record
   */
  async create(data: AnonymousUsageInsert, tx?: TransactionContext): Promise<AnonymousUsage> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO anonymous_usage (device_fingerprint, ip_address, messages_used, last_session_id)
        VALUES (
          ${data.device_fingerprint},
          ${data.ip_address ?? null}::inet,
          ${data.messages_used ?? 0},
          ${data.last_session_id ?? null}
        )
        RETURNING id, device_fingerprint, ip_address, messages_used,
                  last_session_id, first_seen_at, last_seen_at, converted_user_id
      `;

      const usage = this.mapAnonymousUsage(result[0]!);
      logger.debug({ fingerprint: data.device_fingerprint }, 'Anonymous usage record created');
      return usage;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('AnonymousUsage', 'device_fingerprint', data.device_fingerprint);
      }
      throw wrapDatabaseError(error, 'anonymousUsage.create');
    }
  }

  /**
   * Get or create a usage record by fingerprint
   */
  async getOrCreate(
    fingerprint: string,
    ipAddress?: string | null,
    tx?: TransactionContext
  ): Promise<AnonymousUsage> {
    const db = this.getSql(tx);

    // Use upsert to handle race conditions
    const result = await db`
      INSERT INTO anonymous_usage (device_fingerprint, ip_address)
      VALUES (${fingerprint}, ${ipAddress ?? null}::inet)
      ON CONFLICT (device_fingerprint) DO UPDATE SET
        ip_address = COALESCE(${ipAddress ?? null}::inet, anonymous_usage.ip_address),
        last_seen_at = NOW()
      RETURNING id, device_fingerprint, ip_address, messages_used,
                last_session_id, first_seen_at, last_seen_at, converted_user_id
    `;

    return this.mapAnonymousUsage(result[0]!);
  }

  /**
   * Increment messages used for a fingerprint
   */
  async incrementMessages(
    fingerprint: string,
    count: number = 1,
    tx?: TransactionContext
  ): Promise<AnonymousUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE anonymous_usage
      SET
        messages_used = messages_used + ${count},
        last_seen_at = NOW()
      WHERE device_fingerprint = ${fingerprint}
      RETURNING id, device_fingerprint, ip_address, messages_used,
                last_session_id, first_seen_at, last_seen_at, converted_user_id
    `;

    if (!result[0]) {
      throw new NotFoundError('AnonymousUsage', fingerprint);
    }

    logger.debug(
      { fingerprint, newCount: result[0]['messages_used'] },
      'Anonymous usage messages incremented'
    );
    return this.mapAnonymousUsage(result[0]);
  }

  /**
   * Update the last session ID for a fingerprint
   */
  async updateSession(
    fingerprint: string,
    sessionId: UUID,
    tx?: TransactionContext
  ): Promise<AnonymousUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE anonymous_usage
      SET
        last_session_id = ${sessionId},
        last_seen_at = NOW()
      WHERE device_fingerprint = ${fingerprint}
      RETURNING id, device_fingerprint, ip_address, messages_used,
                last_session_id, first_seen_at, last_seen_at, converted_user_id
    `;

    if (!result[0]) {
      throw new NotFoundError('AnonymousUsage', fingerprint);
    }

    logger.debug({ fingerprint, sessionId }, 'Anonymous usage session updated');
    return this.mapAnonymousUsage(result[0]);
  }

  /**
   * Mark a fingerprint as converted to a registered user
   */
  async markConverted(
    fingerprint: string,
    userId: UUID,
    tx?: TransactionContext
  ): Promise<AnonymousUsage> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE anonymous_usage
      SET
        converted_user_id = ${userId},
        last_seen_at = NOW()
      WHERE device_fingerprint = ${fingerprint}
        AND converted_user_id IS NULL
      RETURNING id, device_fingerprint, ip_address, messages_used,
                last_session_id, first_seen_at, last_seen_at, converted_user_id
    `;

    if (!result[0]) {
      throw new NotFoundError('AnonymousUsage', fingerprint);
    }

    logger.info({ fingerprint, userId }, 'Anonymous user converted to registered user');
    return this.mapAnonymousUsage(result[0]);
  }

  /**
   * Check if a fingerprint has remaining messages
   */
  async hasRemainingMessages(
    fingerprint: string,
    limit: number,
    tx?: TransactionContext
  ): Promise<boolean> {
    const usage = await this.getByFingerprint(fingerprint, tx);
    if (!usage) {
      return true; // New user, hasn't used any messages yet
    }
    return usage.messages_used < limit;
  }

  /**
   * Get remaining message count for a fingerprint
   */
  async getRemainingMessages(
    fingerprint: string,
    limit: number,
    tx?: TransactionContext
  ): Promise<number> {
    const usage = await this.getByFingerprint(fingerprint, tx);
    if (!usage) {
      return limit; // New user, full limit available
    }
    return Math.max(0, limit - usage.messages_used);
  }

  // ===========================================================================
  // Listing Operations
  // ===========================================================================

  /**
   * List all anonymous usage records
   */
  async list(
    filters: AnonymousUsageListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<AnonymousUsage>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT id, device_fingerprint, ip_address, messages_used,
             last_session_id, first_seen_at, last_seen_at, converted_user_id
      FROM anonymous_usage
      WHERE TRUE
        ${filters.converted ? db`AND converted_user_id IS NOT NULL` : db``}
        ${filters.unconverted ? db`AND converted_user_id IS NULL` : db``}
      ORDER BY last_seen_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapAnonymousUsage(row));

    return { data, hasMore };
  }

  /**
   * Get conversion stats
   */
  async getConversionStats(tx?: TransactionContext): Promise<{
    totalAnonymous: number;
    totalConverted: number;
    conversionRate: number;
    avgMessagesBeforeConversion: number;
  }> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        COUNT(*) as total_anonymous,
        COUNT(converted_user_id) as total_converted,
        COALESCE(AVG(CASE WHEN converted_user_id IS NOT NULL THEN messages_used END), 0) as avg_messages
      FROM anonymous_usage
    `;

    const row = result[0]!;
    const totalAnonymous = Number(row['total_anonymous']) || 0;
    const totalConverted = Number(row['total_converted']) || 0;
    const avgMessages = Number(row['avg_messages']) || 0;

    return {
      totalAnonymous,
      totalConverted,
      conversionRate: totalAnonymous > 0 ? totalConverted / totalAnonymous : 0,
      avgMessagesBeforeConversion: avgMessages,
    };
  }

  // ===========================================================================
  // Cleanup Operations
  // ===========================================================================

  /**
   * Delete old anonymous usage records that haven't been seen in X days
   */
  async deleteStale(daysOld: number, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM anonymous_usage
      WHERE last_seen_at < NOW() - (${daysOld} || ' days')::interval
        AND converted_user_id IS NULL
      RETURNING id
    `;

    logger.info({ deletedCount: result.length, daysOld }, 'Stale anonymous usage records deleted');
    return result.length;
  }

  // ===========================================================================
  // Row Mapper
  // ===========================================================================

  private mapAnonymousUsage(row: Record<string, unknown>): AnonymousUsage {
    return {
      id: row['id'] as string,
      device_fingerprint: row['device_fingerprint'] as string,
      ip_address: row['ip_address'] as string | null,
      messages_used: row['messages_used'] as number,
      last_session_id: row['last_session_id'] as string | null,
      first_seen_at: row['first_seen_at'] as Date,
      last_seen_at: row['last_seen_at'] as Date,
      converted_user_id: row['converted_user_id'] as string | null,
    };
  }
}

// Singleton instance
let anonymousUsageRepositoryInstance: AnonymousUsageRepository | null = null;

export function getAnonymousUsageRepository(): AnonymousUsageRepository {
  if (!anonymousUsageRepositoryInstance) {
    anonymousUsageRepositoryInstance = new AnonymousUsageRepository();
  }
  return anonymousUsageRepositoryInstance;
}
