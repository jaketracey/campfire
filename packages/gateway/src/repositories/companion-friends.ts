/**
 * Companion Friends Repository
 * Data access for companion_friends table (group chat friendships)
 */

import { sql } from '../db/pool.js';
import type {
  CompanionFriend,
  CompanionFriendInsert,
  UUID,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError, validateUuid } from './errors.js';

/**
 * Companion friend with details about the friend companion
 */
export interface CompanionFriendWithDetails extends CompanionFriend {
  friendName: string;
  friendAvatarUrl: string | null;
  friendStatus: string;
  friendIsPublic: boolean;
  friendOwnerId: string;
}

/**
 * Friend list filters
 */
export interface FriendListFilters extends PaginationOptions {
  companionId: string;
  relationshipType?: string;
}

export class CompanionFriendsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Find a friendship by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<CompanionFriend | null> {
    validateUuid(id, 'friendship.id');

    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, friend_companion_id, relationship_type,
        how_they_met, nickname, familiarity_level, created_at, updated_at
      FROM companion_friends
      WHERE id = ${id}
    `;

    return result[0] ? this.mapFriend(result[0]) : null;
  }

  /**
   * Find a friendship by companion pair
   */
  async findByCompanionPair(
    companionId: string,
    friendCompanionId: string,
    tx?: TransactionContext
  ): Promise<CompanionFriend | null> {
    validateUuid(companionId, 'companion.id');
    validateUuid(friendCompanionId, 'friend.companion.id');

    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, friend_companion_id, relationship_type,
        how_they_met, nickname, familiarity_level, created_at, updated_at
      FROM companion_friends
      WHERE companion_id = ${companionId}
        AND friend_companion_id = ${friendCompanionId}
    `;

    return result[0] ? this.mapFriend(result[0]) : null;
  }

  /**
   * Check if two companions are friends (either direction)
   */
  async areFriends(
    companionId: string,
    friendCompanionId: string,
    tx?: TransactionContext
  ): Promise<boolean> {
    const friendship = await this.findByCompanionPair(companionId, friendCompanionId, tx);
    return friendship !== null;
  }

  /**
   * Create a single friendship record
   */
  async create(
    data: CompanionFriendInsert,
    tx?: TransactionContext
  ): Promise<CompanionFriend> {
    validateUuid(data.companion_id, 'companion.id');
    validateUuid(data.friend_companion_id, 'friend.companion.id');

    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO companion_friends (
          companion_id, friend_companion_id, relationship_type,
          how_they_met, nickname, familiarity_level
        )
        VALUES (
          ${data.companion_id},
          ${data.friend_companion_id},
          ${data.relationship_type ?? null},
          ${data.how_they_met ?? null},
          ${data.nickname ?? null},
          ${data.familiarity_level ?? 50}
        )
        RETURNING
          id, companion_id, friend_companion_id, relationship_type,
          how_they_met, nickname, familiarity_level, created_at, updated_at
      `;

      return this.mapFriend(result[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError(
          'companion_friends',
          'companion_id_friend_companion_id',
          `${data.companion_id}_${data.friend_companion_id}`
        );
      }
      throw wrapDatabaseError(error, 'companion_friends.create');
    }
  }

  /**
   * Create bidirectional friendship (two records)
   */
  async createBidirectional(
    companionId: string,
    friendCompanionId: string,
    metadata?: {
      relationshipType?: string | null;
      howTheyMet?: string | null;
    },
    tx?: TransactionContext
  ): Promise<[CompanionFriend, CompanionFriend]> {
    validateUuid(companionId, 'companion.id');
    validateUuid(friendCompanionId, 'friend.companion.id');

    const db = this.getSql(tx);

    try {
      // Create both directions atomically
      const result = await db`
        INSERT INTO companion_friends (
          companion_id, friend_companion_id, relationship_type, how_they_met
        )
        VALUES
          (${companionId}, ${friendCompanionId}, ${metadata?.relationshipType ?? null}, ${metadata?.howTheyMet ?? null}),
          (${friendCompanionId}, ${companionId}, ${metadata?.relationshipType ?? null}, ${metadata?.howTheyMet ?? null})
        RETURNING
          id, companion_id, friend_companion_id, relationship_type,
          how_they_met, nickname, familiarity_level, created_at, updated_at
      `;

      return [this.mapFriend(result[0]), this.mapFriend(result[1])];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError(
          'companion_friends',
          'companion_id_friend_companion_id',
          `${companionId}_${friendCompanionId}`
        );
      }
      throw wrapDatabaseError(error, 'companion_friends.createBidirectional');
    }
  }

  /**
   * Update a friendship
   */
  async update(
    id: string,
    data: Partial<CompanionFriendInsert>,
    tx?: TransactionContext
  ): Promise<CompanionFriend> {
    validateUuid(id, 'friendship.id');

    const db = this.getSql(tx);

    const result = await db`
      UPDATE companion_friends
      SET
        relationship_type = COALESCE(${data.relationship_type ?? null}, relationship_type),
        how_they_met = COALESCE(${data.how_they_met ?? null}, how_they_met),
        nickname = COALESCE(${data.nickname ?? null}, nickname),
        familiarity_level = COALESCE(${data.familiarity_level ?? null}, familiarity_level),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING
        id, companion_id, friend_companion_id, relationship_type,
        how_they_met, nickname, familiarity_level, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('companion_friends', id);
    }

    return this.mapFriend(result[0]);
  }

  /**
   * Delete a single friendship record
   */
  async delete(id: string, tx?: TransactionContext): Promise<void> {
    validateUuid(id, 'friendship.id');

    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM companion_friends
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('companion_friends', id);
    }
  }

  /**
   * Delete bidirectional friendship (both records)
   */
  async deleteBidirectional(
    companionId: string,
    friendCompanionId: string,
    tx?: TransactionContext
  ): Promise<void> {
    validateUuid(companionId, 'companion.id');
    validateUuid(friendCompanionId, 'friend.companion.id');

    const db = this.getSql(tx);

    await db`
      DELETE FROM companion_friends
      WHERE (companion_id = ${companionId} AND friend_companion_id = ${friendCompanionId})
         OR (companion_id = ${friendCompanionId} AND friend_companion_id = ${companionId})
    `;
  }

  // ===========================================================================
  // List Operations
  // ===========================================================================

  /**
   * List friends for a companion with details
   */
  async listFriends(
    filters: FriendListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<CompanionFriendWithDetails>> {
    validateUuid(filters.companionId, 'companion.id');

    const db = this.getSql(tx);
    const { companionId, relationshipType, limit = 50, offset = 0 } = filters;

    // Build conditions
    const conditions = [db`cf.companion_id = ${companionId}`];
    if (relationshipType) {
      conditions.push(db`cf.relationship_type = ${relationshipType}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((a, b) => db`${a} AND ${b}`)}`;

    // Get count
    const countResult = await db`
      SELECT COUNT(*)::int as count
      FROM companion_friends cf
      ${whereClause}
    `;
    const total = countResult[0]?.count ?? 0;

    // Get items with friend details
    const result = await db`
      SELECT
        cf.id, cf.companion_id, cf.friend_companion_id, cf.relationship_type,
        cf.how_they_met, cf.nickname, cf.familiarity_level,
        cf.created_at, cf.updated_at,
        c.name as friend_name,
        c.status as friend_status,
        c.is_public as friend_is_public,
        c.user_id as friend_owner_id,
        a.asset_url as friend_avatar_url
      FROM companion_friends cf
      JOIN companions c ON cf.friend_companion_id = c.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      ${whereClause}
      ORDER BY cf.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return {
      data: result.map((row) => this.mapFriendWithDetails(row)),
      total,
      hasMore: offset + result.length < total,
      limit,
    };
  }

  /**
   * Get mutual friends between two companions
   */
  async getMutualFriends(
    companionId: string,
    otherCompanionId: string,
    tx?: TransactionContext
  ): Promise<CompanionFriendWithDetails[]> {
    validateUuid(companionId, 'companion.id');
    validateUuid(otherCompanionId, 'other.companion.id');

    const db = this.getSql(tx);

    const result = await db`
      SELECT
        cf.id, cf.companion_id, cf.friend_companion_id, cf.relationship_type,
        cf.how_they_met, cf.nickname, cf.familiarity_level,
        cf.created_at, cf.updated_at,
        c.name as friend_name,
        c.status as friend_status,
        c.is_public as friend_is_public,
        c.user_id as friend_owner_id,
        a.asset_url as friend_avatar_url
      FROM companion_friends cf
      JOIN companions c ON cf.friend_companion_id = c.id
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      WHERE cf.companion_id = ${companionId}
        AND cf.friend_companion_id IN (
          SELECT friend_companion_id FROM companion_friends
          WHERE companion_id = ${otherCompanionId}
        )
      ORDER BY cf.created_at DESC
    `;

    return result.map((row) => this.mapFriendWithDetails(row));
  }

  /**
   * Get friend IDs for a companion (for quick lookups)
   */
  async getFriendIds(
    companionId: string,
    tx?: TransactionContext
  ): Promise<UUID[]> {
    validateUuid(companionId, 'companion.id');

    const db = this.getSql(tx);

    const result = await db`
      SELECT friend_companion_id
      FROM companion_friends
      WHERE companion_id = ${companionId}
    `;

    return result.map((row) => row.friend_companion_id as UUID);
  }

  // ===========================================================================
  // Mapping Functions
  // ===========================================================================

  private mapFriend(row: Record<string, unknown>): CompanionFriend {
    return {
      id: row.id as string,
      companion_id: row.companion_id as string,
      friend_companion_id: row.friend_companion_id as string,
      relationship_type: row.relationship_type as string | null,
      how_they_met: row.how_they_met as string | null,
      nickname: row.nickname as string | null,
      familiarity_level: row.familiarity_level as number,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapFriendWithDetails(row: Record<string, unknown>): CompanionFriendWithDetails {
    return {
      ...this.mapFriend(row),
      friendName: row.friend_name as string,
      friendAvatarUrl: row.friend_avatar_url as string | null,
      friendStatus: row.friend_status as string,
      friendIsPublic: row.friend_is_public as boolean,
      friendOwnerId: row.friend_owner_id as string,
    };
  }
}

// Singleton instance
let instance: CompanionFriendsRepository | null = null;

export function getCompanionFriendsRepository(): CompanionFriendsRepository {
  if (!instance) {
    instance = new CompanionFriendsRepository();
  }
  return instance;
}
