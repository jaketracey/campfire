/**
 * Companions Repository
 * Data access for companions, companion_versions, and companion_avatars tables
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  Companion,
  CompanionInsert,
  CompanionSpec,
  CompanionStatus,
  CompanionAvatar,
  CompanionAvatarInsert,
  AvatarAssetType,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

/**
 * Companion version record
 */
export interface CompanionVersion {
  id: string;
  companionId: string;
  version: number;
  spec: CompanionSpec;
  changeSummary: string | null;
  sourceEventId: string | null;
  createdAt: Date;
}

/**
 * Companion with active avatar
 */
export interface CompanionWithAvatar extends Companion {
  activeAvatar: CompanionAvatar | null;
}

/**
 * Companion list filters
 */
export interface CompanionListFilters extends PaginationOptions {
  userId: string;
  status?: CompanionStatus;
  search?: string;
}

export class CompanionsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Companions
  // ===========================================================================

  async findById(id: string, tx?: TransactionContext): Promise<Companion | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, name, spec, spec_version, status, is_public,
        active_avatar_id, created_at, updated_at
      FROM companions
      WHERE id = ${id}
    `;

    return result[0] ? this.mapCompanion(result[0]) : null;
  }

  async findByIdWithAvatar(id: string, tx?: TransactionContext): Promise<CompanionWithAvatar | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        c.id, c.user_id, c.name, c.spec, c.spec_version, c.status, c.is_public,
        c.active_avatar_id, c.created_at, c.updated_at,
        a.id as avatar_id, a.asset_url, a.asset_type, a.is_active,
        a.is_identity_anchor, a.metadata as avatar_metadata,
        a.generation_params, a.source_event_id as avatar_source_event_id,
        a.created_at as avatar_created_at
      FROM companions c
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      WHERE c.id = ${id}
    `;

    if (!result[0]) {
      return null;
    }

    const companion = this.mapCompanion(result[0]);
    const activeAvatar = result[0]['avatar_id']
      ? this.mapAvatarFromJoin(result[0])
      : null;

    return { ...companion, activeAvatar };
  }

  async findByUserIdAndName(
    userId: string,
    name: string,
    tx?: TransactionContext
  ): Promise<Companion | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, user_id, name, spec, spec_version, status, is_public,
        active_avatar_id, created_at, updated_at
      FROM companions
      WHERE user_id = ${userId} AND LOWER(name) = LOWER(${name})
    `;

    return result[0] ? this.mapCompanion(result[0]) : null;
  }

  /**
   * Find a public companion by ID with avatar (no auth required)
   */
  async findPublicById(id: string, tx?: TransactionContext): Promise<CompanionWithAvatar | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        c.id, c.user_id, c.name, c.spec, c.spec_version, c.status, c.is_public,
        c.active_avatar_id, c.created_at, c.updated_at,
        a.id as avatar_id, a.asset_url, a.asset_type, a.is_active,
        a.is_identity_anchor, a.metadata as avatar_metadata,
        a.generation_params, a.source_event_id as avatar_source_event_id,
        a.created_at as avatar_created_at
      FROM companions c
      LEFT JOIN companion_avatars a ON c.active_avatar_id = a.id
      WHERE c.id = ${id} AND c.is_public = TRUE AND c.status = 'active'
    `;

    if (!result[0]) {
      return null;
    }

    const companion = this.mapCompanion(result[0]);
    const activeAvatar = result[0]['avatar_id']
      ? this.mapAvatarFromJoin(result[0])
      : null;

    return { ...companion, activeAvatar };
  }

  async create(data: CompanionInsert, tx?: TransactionContext): Promise<Companion> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO companions (
          user_id, name, spec, spec_version, status, is_public
        ) VALUES (
          ${data.user_id},
          ${data.name},
          ${JSON.stringify(data.spec)},
          ${data.spec_version ?? 1},
          ${data.status ?? 'draft'},
          ${data.is_public ?? false}
        )
        RETURNING
          id, user_id, name, spec, spec_version, status, is_public,
          active_avatar_id, created_at, updated_at
      `;

      const companion = this.mapCompanion(result[0]!);
      logger.debug({ companionId: companion.id, userId: data.user_id }, 'Companion created');
      return companion;
    } catch (error) {
      throw wrapDatabaseError(error, 'companions.create');
    }
  }

  async update(
    id: string,
    data: Partial<Omit<CompanionInsert, 'user_id'>>,
    tx?: TransactionContext
  ): Promise<Companion> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE companions
      SET
        name = COALESCE(${data.name ?? null}, name),
        spec = COALESCE(${data.spec ? JSON.stringify(data.spec) : null}, spec),
        status = COALESCE(${data.status ?? null}, status),
        is_public = COALESCE(${data.is_public ?? null}, is_public)
      WHERE id = ${id}
      RETURNING
        id, user_id, name, spec, spec_version, status, is_public,
        active_avatar_id, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Companion', id);
    }

    return this.mapCompanion(result[0]);
  }

  async updateSpec(
    id: string,
    spec: CompanionSpec,
    changeSummary?: string,
    sourceEventId?: string,
    tx?: TransactionContext
  ): Promise<Companion> {
    const db = this.getSql(tx);

    // The trigger will auto-increment spec_version and archive the old spec
    const result = await db`
      UPDATE companions
      SET spec = ${JSON.stringify(spec)}
      WHERE id = ${id}
      RETURNING
        id, user_id, name, spec, spec_version, status, is_public,
        active_avatar_id, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Companion', id);
    }

    // Update the archived version with additional metadata
    if (changeSummary || sourceEventId) {
      const newVersion = (result[0]['spec_version'] as number) - 1;
      await db`
        UPDATE companion_versions
        SET
          change_summary = COALESCE(${changeSummary ?? null}, change_summary),
          source_event_id = COALESCE(${sourceEventId ?? null}, source_event_id)
        WHERE companion_id = ${id} AND version = ${newVersion}
      `;
    }

    return this.mapCompanion(result[0]);
  }

  async archive(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE companions
      SET status = 'archived'
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('Companion', id);
    }
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM companions
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('Companion', id);
    }
  }

  async list(filters: CompanionListFilters, tx?: TransactionContext): Promise<PaginatedResult<Companion>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [db`user_id = ${filters.userId}`];

    if (filters.status) {
      conditions.push(db`status = ${filters.status}`);
    }
    if (filters.search) {
      conditions.push(db`name ILIKE ${'%' + filters.search + '%'}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT
        id, user_id, name, spec, spec_version, status, is_public,
        active_avatar_id, created_at, updated_at
      FROM companions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapCompanion(row));

    return { data, hasMore };
  }

  async countByUser(userId: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT COUNT(*)::int as count
      FROM companions
      WHERE user_id = ${userId} AND status != 'archived'
    `;

    return result[0]?.['count'] ?? 0;
  }

  // ===========================================================================
  // Companion Versions
  // ===========================================================================

  async getVersionHistory(
    companionId: string,
    options: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<CompanionVersion>> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const result = await db`
      SELECT
        id, companion_id, version, spec, change_summary,
        source_event_id, created_at
      FROM companion_versions
      WHERE companion_id = ${companionId}
      ORDER BY version DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapCompanionVersion(row));

    return { data, hasMore };
  }

  async getVersion(
    companionId: string,
    version: number,
    tx?: TransactionContext
  ): Promise<CompanionVersion | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, version, spec, change_summary,
        source_event_id, created_at
      FROM companion_versions
      WHERE companion_id = ${companionId} AND version = ${version}
    `;

    return result[0] ? this.mapCompanionVersion(result[0]) : null;
  }

  // ===========================================================================
  // Companion Avatars
  // ===========================================================================

  async findAvatarById(id: string, tx?: TransactionContext): Promise<CompanionAvatar | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, asset_url, asset_type, s3_bucket, s3_key,
        is_active, is_identity_anchor, metadata, generation_params,
        source_event_id, content_hash, width, height, size_bytes, created_at
      FROM companion_avatars
      WHERE id = ${id}
    `;

    return result[0] ? this.mapAvatar(result[0]) : null;
  }

  async createAvatar(data: CompanionAvatarInsert, tx?: TransactionContext): Promise<CompanionAvatar> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO companion_avatars (
        companion_id, asset_url, asset_type, is_active, is_identity_anchor,
        metadata, generation_params, source_event_id
      ) VALUES (
        ${data.companion_id},
        ${data.asset_url},
        ${data.asset_type},
        ${data.is_active ?? false},
        ${data.is_identity_anchor ?? false},
        ${JSON.stringify(data.metadata ?? {})},
        ${data.generation_params ? JSON.stringify(data.generation_params) : null},
        ${data.source_event_id ?? null}
      )
      RETURNING
        id, companion_id, asset_url, asset_type, s3_bucket, s3_key,
        is_active, is_identity_anchor, metadata, generation_params,
        source_event_id, content_hash, width, height, size_bytes, created_at
    `;

    const avatar = this.mapAvatar(result[0]!);
    logger.debug({ avatarId: avatar.id, companionId: data.companion_id }, 'Avatar created');
    return avatar;
  }

  async setActiveAvatar(companionId: string, avatarId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    // The trigger will handle deactivating other avatars and updating the companion
    await db`
      UPDATE companion_avatars
      SET is_active = TRUE
      WHERE id = ${avatarId} AND companion_id = ${companionId}
    `;
  }

  async listAvatars(
    companionId: string,
    options: { assetType?: AvatarAssetType } & PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<CompanionAvatar>> {
    const db = this.getSql(tx);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const conditions: ReturnType<typeof db>[] = [db`companion_id = ${companionId}`];

    if (options.assetType) {
      conditions.push(db`asset_type = ${options.assetType}`);
    }

    const whereClause = db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`;

    const result = await db`
      SELECT
        id, companion_id, asset_url, asset_type, s3_bucket, s3_key,
        is_active, is_identity_anchor, metadata, generation_params,
        source_event_id, content_hash, width, height, size_bytes, created_at
      FROM companion_avatars
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapAvatar(row));

    return { data, hasMore };
  }

  async getActiveAvatar(companionId: string, tx?: TransactionContext): Promise<CompanionAvatar | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, asset_url, asset_type, s3_bucket, s3_key,
        is_active, is_identity_anchor, metadata, generation_params,
        source_event_id, content_hash, width, height, size_bytes, created_at
      FROM companion_avatars
      WHERE companion_id = ${companionId} AND is_active = TRUE
    `;

    return result[0] ? this.mapAvatar(result[0]) : null;
  }

  async getIdentityAnchor(companionId: string, tx?: TransactionContext): Promise<CompanionAvatar | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id, companion_id, asset_url, asset_type, s3_bucket, s3_key,
        is_active, is_identity_anchor, metadata, generation_params,
        source_event_id, content_hash, width, height, size_bytes, created_at
      FROM companion_avatars
      WHERE companion_id = ${companionId} AND is_identity_anchor = TRUE
      LIMIT 1
    `;

    return result[0] ? this.mapAvatar(result[0]) : null;
  }

  async deleteAvatar(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM companion_avatars
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('CompanionAvatar', id);
    }
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapCompanion(row: Record<string, unknown>): Companion {
    return {
      id: row['id'] as string,
      user_id: row['user_id'] as string,
      name: row['name'] as string,
      spec: row['spec'] as CompanionSpec,
      spec_version: row['spec_version'] as number,
      status: row['status'] as CompanionStatus,
      is_public: row['is_public'] as boolean,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }

  private mapCompanionVersion(row: Record<string, unknown>): CompanionVersion {
    return {
      id: row['id'] as string,
      companionId: row['companion_id'] as string,
      version: row['version'] as number,
      spec: row['spec'] as CompanionSpec,
      changeSummary: row['change_summary'] as string | null,
      sourceEventId: row['source_event_id'] as string | null,
      createdAt: row['created_at'] as Date,
    };
  }

  private mapAvatar(row: Record<string, unknown>): CompanionAvatar {
    return {
      id: row['id'] as string,
      companion_id: row['companion_id'] as string,
      asset_url: row['asset_url'] as string,
      asset_type: row['asset_type'] as AvatarAssetType,
      is_active: row['is_active'] as boolean,
      is_identity_anchor: row['is_identity_anchor'] as boolean,
      metadata: row['metadata'] as JSONObject,
      generation_params: row['generation_params'] as JSONObject | null,
      source_event_id: row['source_event_id'] as string | null,
      created_at: row['created_at'] as Date,
    };
  }

  private mapAvatarFromJoin(row: Record<string, unknown>): CompanionAvatar {
    return {
      id: row['avatar_id'] as string,
      companion_id: row['id'] as string,
      asset_url: row['asset_url'] as string,
      asset_type: row['asset_type'] as AvatarAssetType,
      is_active: row['is_active'] as boolean,
      is_identity_anchor: row['is_identity_anchor'] as boolean,
      metadata: row['avatar_metadata'] as JSONObject,
      generation_params: row['generation_params'] as JSONObject | null,
      source_event_id: row['avatar_source_event_id'] as string | null,
      created_at: row['avatar_created_at'] as Date,
    };
  }
}

// Singleton instance
let companionsRepositoryInstance: CompanionsRepository | null = null;

export function getCompanionsRepository(): CompanionsRepository {
  if (!companionsRepositoryInstance) {
    companionsRepositoryInstance = new CompanionsRepository();
  }
  return companionsRepositoryInstance;
}
