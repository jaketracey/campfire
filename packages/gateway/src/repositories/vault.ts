/**
 * Vault Repository
 * Data access for vault_files, vault_links, and vault_render_queue tables
 * Handles Obsidian-style vault projection storage
 */

import postgres from 'postgres';
import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  VaultFile,
  VaultFileInsert,
  VaultFileType,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError } from './errors.js';

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Vault file with extended metadata
 */
export interface VaultFileWithMetadata extends VaultFile {
  title: string | null;
  frontmatter: JSONObject;
  tags: string[];
  version: number;
  previousVersionId: string | null;
  lastRenderedAt: Date;
  renderDurationMs: number | null;
  sourceSessionId: string | null;
  sourceTurnIds: string[];
}

/**
 * Vault file insert with all fields
 */
export interface VaultFileInsertFull extends VaultFileInsert {
  title?: string | null;
  frontmatter?: JSONObject;
  tags?: string[];
  sourceSessionId?: string | null;
  sourceTurnIds?: string[];
  previousVersionId?: string | null;
  renderDurationMs?: number | null;
}

/**
 * Vault link entity
 */
export interface VaultLink {
  id: string;
  userId: string;
  sourceFileId: string;
  sourcePath: string;
  targetFileId: string | null;
  targetPath: string;
  linkText: string | null;
  linkType: string;
  context: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  createdAt: Date;
}

/**
 * Vault link insert
 */
export interface VaultLinkInsert {
  userId: string;
  sourceFileId: string;
  sourcePath: string;
  targetPath: string;
  targetFileId?: string | null;
  linkText?: string | null;
  linkType?: string;
  context?: string | null;
  lineNumber?: number | null;
  columnNumber?: number | null;
}

/**
 * Render queue job status
 */
export type RenderStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Render queue job
 */
export interface RenderJob {
  id: string;
  userId: string;
  renderType: VaultFileType;
  targetPath: string | null;
  sourceEventId: string | null;
  sourceSessionId: string | null;
  priority: number;
  scheduledAt: Date;
  status: RenderStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  retryCount: number;
  resultFileId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

/**
 * Render job insert
 */
export interface RenderJobInsert {
  userId: string;
  renderType: VaultFileType;
  targetPath?: string | null;
  sourceEventId?: string | null;
  sourceSessionId?: string | null;
  priority?: number;
}

/**
 * Backlink result
 */
export interface Backlink {
  sourceFileId: string;
  sourcePath: string;
  linkText: string | null;
  context: string | null;
}

/**
 * Vault file list filters
 */
export interface VaultFileListFilters extends PaginationOptions {
  companionId?: string;
  fileType?: VaultFileType;
  pathPrefix?: string;
  tags?: string[];
  sessionId?: string;
}

/**
 * Render job list filters
 */
export interface RenderJobListFilters extends PaginationOptions {
  status?: RenderStatus;
  renderType?: VaultFileType;
  sessionId?: string;
}

// ============================================================================
// Repository
// ============================================================================

export class VaultRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Vault Files
  // ===========================================================================

  async findFileById(id: string, tx?: TransactionContext): Promise<VaultFileWithMetadata | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        version, previous_version_id, last_rendered_at, render_duration_ms,
        created_at, updated_at
      FROM vault_files
      WHERE id = ${id}
    `;

    return result[0] ? this.mapVaultFile(result[0]) : null;
  }

  async findFileByPath(userId: string, path: string, tx?: TransactionContext): Promise<VaultFileWithMetadata | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        version, previous_version_id, last_rendered_at, render_duration_ms,
        created_at, updated_at
      FROM vault_files
      WHERE user_id = ${userId} AND path = ${path}
    `;

    return result[0] ? this.mapVaultFile(result[0]) : null;
  }

  async createFile(data: VaultFileInsertFull, tx?: TransactionContext): Promise<VaultFileWithMetadata> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO vault_files (
          user_id, companion_id, path, file_type, content_hash,
          s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
          source_event_ids, source_session_id, source_turn_ids,
          previous_version_id, render_duration_ms
        ) VALUES (
          ${data.user_id},
          ${data.companion_id ?? null},
          ${data.path},
          ${data.file_type},
          ${data.content_hash},
          ${data.s3_bucket},
          ${data.s3_key},
          ${data.size_bytes},
          ${data.title ?? null},
          ${db.json((data.frontmatter ?? {}) as postgres.JSONValue)},
          ${data.tags ?? []},
          ${data.source_event_ids ?? []},
          ${data.sourceSessionId ?? null},
          ${data.sourceTurnIds ?? []},
          ${data.previousVersionId ?? null},
          ${data.renderDurationMs ?? null}
        )
        RETURNING
          id, user_id, companion_id, path, file_type, content_hash,
          s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
          source_event_ids, source_session_id, source_turn_ids,
          version, previous_version_id, last_rendered_at, render_duration_ms,
          created_at, updated_at
      `;

      const file = this.mapVaultFile(result[0]!);
      logger.debug({ fileId: file.id, path: data.path }, 'Vault file created');
      return file;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('VaultFile', 'path', data.path);
      }
      throw wrapDatabaseError(error, 'vault.createFile');
    }
  }

  async updateFile(
    id: string,
    data: Partial<VaultFileInsertFull>,
    tx?: TransactionContext
  ): Promise<VaultFileWithMetadata> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE vault_files
      SET
        content_hash = COALESCE(${data.content_hash ?? null}, content_hash),
        s3_key = COALESCE(${data.s3_key ?? null}, s3_key),
        size_bytes = COALESCE(${data.size_bytes ?? null}, size_bytes),
        title = COALESCE(${data.title ?? null}, title),
        frontmatter = COALESCE(${data.frontmatter ? db.json(data.frontmatter as postgres.JSONValue) : null}, frontmatter),
        tags = COALESCE(${data.tags ?? null}, tags),
        source_event_ids = COALESCE(${data.source_event_ids ?? null}, source_event_ids),
        render_duration_ms = COALESCE(${data.renderDurationMs ?? null}, render_duration_ms),
        version = version + 1,
        last_rendered_at = NOW()
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        version, previous_version_id, last_rendered_at, render_duration_ms,
        created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('VaultFile', id);
    }

    logger.debug({ fileId: id }, 'Vault file updated');
    return this.mapVaultFile(result[0]);
  }

  async upsertFile(data: VaultFileInsertFull, tx?: TransactionContext): Promise<VaultFileWithMetadata> {
    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO vault_files (
        user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        previous_version_id, render_duration_ms
      ) VALUES (
        ${data.user_id},
        ${data.companion_id ?? null},
        ${data.path},
        ${data.file_type},
        ${data.content_hash},
        ${data.s3_bucket},
        ${data.s3_key},
        ${data.size_bytes},
        ${data.title ?? null},
        ${db.json((data.frontmatter ?? {}) as postgres.JSONValue)},
        ${data.tags ?? []},
        ${data.source_event_ids ?? []},
        ${data.sourceSessionId ?? null},
        ${data.sourceTurnIds ?? []},
        ${data.previousVersionId ?? null},
        ${data.renderDurationMs ?? null}
      )
      ON CONFLICT (user_id, path) DO UPDATE SET
        content_hash = EXCLUDED.content_hash,
        s3_key = EXCLUDED.s3_key,
        size_bytes = EXCLUDED.size_bytes,
        title = EXCLUDED.title,
        frontmatter = EXCLUDED.frontmatter,
        tags = EXCLUDED.tags,
        source_event_ids = vault_files.source_event_ids || EXCLUDED.source_event_ids,
        render_duration_ms = EXCLUDED.render_duration_ms,
        version = vault_files.version + 1,
        previous_version_id = vault_files.id,
        last_rendered_at = NOW()
      RETURNING
        id, user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        version, previous_version_id, last_rendered_at, render_duration_ms,
        created_at, updated_at
    `;

    return this.mapVaultFile(result[0]!);
  }

  async deleteFile(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`DELETE FROM vault_files WHERE id = ${id}`;

    if (result.count === 0) {
      throw new NotFoundError('VaultFile', id);
    }

    logger.debug({ fileId: id }, 'Vault file deleted');
  }

  async listFiles(
    userId: string,
    filters: VaultFileListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<VaultFileWithMetadata>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        version, previous_version_id, last_rendered_at, render_duration_ms,
        created_at, updated_at
      FROM vault_files
      WHERE user_id = ${userId}
        ${filters.companionId ? db`AND companion_id = ${filters.companionId}` : db``}
        ${filters.fileType ? db`AND file_type = ${filters.fileType}` : db``}
        ${filters.pathPrefix ? db`AND path LIKE ${filters.pathPrefix + '%'}` : db``}
        ${filters.tags && filters.tags.length > 0 ? db`AND tags && ${filters.tags}` : db``}
        ${filters.sessionId ? db`AND source_session_id = ${filters.sessionId}` : db``}
      ORDER BY path ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapVaultFile(row));

    return { data, hasMore };
  }

  async listFilesByType(
    userId: string,
    fileType: VaultFileType,
    options: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<VaultFileWithMetadata>> {
    return this.listFiles(userId, { ...options, fileType }, tx);
  }

  async findFilesBySession(
    sessionId: string,
    tx?: TransactionContext
  ): Promise<VaultFileWithMetadata[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, path, file_type, content_hash,
        s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
        source_event_ids, source_session_id, source_turn_ids,
        version, previous_version_id, last_rendered_at, render_duration_ms,
        created_at, updated_at
      FROM vault_files
      WHERE source_session_id = ${sessionId}
      ORDER BY path ASC
    `;

    return result.map(row => this.mapVaultFile(row));
  }

  async searchByTags(
    userId: string,
    tags: string[],
    options: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<VaultFileWithMetadata>> {
    return this.listFiles(userId, { ...options, tags }, tx);
  }

  async getFileVersionHistory(
    userId: string,
    path: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<VaultFileWithMetadata[]> {
    const db = this.getSql(tx);

    // Get the current file first
    const current = await this.findFileByPath(userId, path, tx);
    if (!current) {
      return [];
    }

    const versions: VaultFileWithMetadata[] = [current];
    let previousId = current.previousVersionId;

    // Walk the version chain
    while (previousId && versions.length < limit) {
      const result = await db`
        SELECT
          id, user_id, companion_id, path, file_type, content_hash,
          s3_bucket, s3_key, size_bytes, title, frontmatter, tags,
          source_event_ids, source_session_id, source_turn_ids,
          version, previous_version_id, last_rendered_at, render_duration_ms,
          created_at, updated_at
        FROM vault_files
        WHERE id = ${previousId}
      `;

      if (!result[0]) break;

      const file = this.mapVaultFile(result[0]);
      versions.push(file);
      previousId = file.previousVersionId;
    }

    return versions;
  }

  async getTotalSize(userId: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT COALESCE(SUM(size_bytes), 0) as total_size
      FROM vault_files
      WHERE user_id = ${userId}
    `;
    return Number(result[0]?.total_size ?? 0);
  }

  async countFiles(userId: string, fileType?: VaultFileType, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT COUNT(*) as count
      FROM vault_files
      WHERE user_id = ${userId}
        ${fileType ? db`AND file_type = ${fileType}` : db``}
    `;
    return Number(result[0]?.count ?? 0);
  }

  // ===========================================================================
  // Vault Links
  // ===========================================================================

  async findLinkById(id: string, tx?: TransactionContext): Promise<VaultLink | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, source_file_id, source_path,
        target_file_id, target_path, link_text, link_type,
        context, line_number, column_number, created_at
      FROM vault_links
      WHERE id = ${id}
    `;

    return result[0] ? this.mapVaultLink(result[0]) : null;
  }

  async createLink(data: VaultLinkInsert, tx?: TransactionContext): Promise<VaultLink> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO vault_links (
          user_id, source_file_id, source_path,
          target_file_id, target_path, link_text, link_type,
          context, line_number, column_number
        ) VALUES (
          ${data.userId},
          ${data.sourceFileId},
          ${data.sourcePath},
          ${data.targetFileId ?? null},
          ${data.targetPath},
          ${data.linkText ?? null},
          ${data.linkType ?? 'wikilink'},
          ${data.context ?? null},
          ${data.lineNumber ?? null},
          ${data.columnNumber ?? null}
        )
        RETURNING
          id, user_id, source_file_id, source_path,
          target_file_id, target_path, link_text, link_type,
          context, line_number, column_number, created_at
      `;

      return this.mapVaultLink(result[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('VaultLink', 'source_target', `${data.sourceFileId}:${data.targetPath}`);
      }
      throw wrapDatabaseError(error, 'vault.createLink');
    }
  }

  async createLinks(links: VaultLinkInsert[], tx?: TransactionContext): Promise<VaultLink[]> {
    if (links.length === 0) return [];

    const db = this.getSql(tx);

    const values = links.map(l => ({
      user_id: l.userId,
      source_file_id: l.sourceFileId,
      source_path: l.sourcePath,
      target_file_id: l.targetFileId ?? null,
      target_path: l.targetPath,
      link_text: l.linkText ?? null,
      link_type: l.linkType ?? 'wikilink',
      context: l.context ?? null,
      line_number: l.lineNumber ?? null,
      column_number: l.columnNumber ?? null,
    }));

    const result = await db`
      INSERT INTO vault_links ${db(values)}
      ON CONFLICT (source_file_id, target_path, line_number) DO NOTHING
      RETURNING
        id, user_id, source_file_id, source_path,
        target_file_id, target_path, link_text, link_type,
        context, line_number, column_number, created_at
    `;

    return result.map(row => this.mapVaultLink(row));
  }

  async deleteLinksFromFile(fileId: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`DELETE FROM vault_links WHERE source_file_id = ${fileId}`;
    return result.count;
  }

  async getOutgoingLinks(fileId: string, tx?: TransactionContext): Promise<VaultLink[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, source_file_id, source_path,
        target_file_id, target_path, link_text, link_type,
        context, line_number, column_number, created_at
      FROM vault_links
      WHERE source_file_id = ${fileId}
      ORDER BY line_number
    `;

    return result.map(row => this.mapVaultLink(row));
  }

  async getBacklinks(fileId: string, tx?: TransactionContext): Promise<Backlink[]> {
    const db = this.getSql(tx);
    const result = await db`SELECT * FROM get_backlinks(${fileId})`;

    return result.map(row => ({
      sourceFileId: row.source_file_id as string,
      sourcePath: row.source_path as string,
      linkText: row.link_text as string | null,
      context: row.context as string | null,
    }));
  }

  async getBacklinksByPath(userId: string, path: string, tx?: TransactionContext): Promise<Backlink[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        source_file_id, source_path, link_text, context
      FROM vault_links
      WHERE user_id = ${userId} AND target_path = ${path}
      ORDER BY source_path
    `;

    return result.map(row => ({
      sourceFileId: row.source_file_id as string,
      sourcePath: row.source_path as string,
      linkText: row.link_text as string | null,
      context: row.context as string | null,
    }));
  }

  async getUnresolvedLinks(userId: string, tx?: TransactionContext): Promise<VaultLink[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, source_file_id, source_path,
        target_file_id, target_path, link_text, link_type,
        context, line_number, column_number, created_at
      FROM vault_links
      WHERE user_id = ${userId} AND target_file_id IS NULL
      ORDER BY target_path
    `;

    return result.map(row => this.mapVaultLink(row));
  }

  // ===========================================================================
  // Render Queue
  // ===========================================================================

  async findRenderJobById(id: string, tx?: TransactionContext): Promise<RenderJob | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, render_type, target_path, source_event_id,
        source_session_id, priority, scheduled_at, status,
        started_at, completed_at, error, retry_count,
        result_file_id, idempotency_key, created_at
      FROM vault_render_queue
      WHERE id = ${id}
    `;

    return result[0] ? this.mapRenderJob(result[0]) : null;
  }

  async enqueueRenderJob(data: RenderJobInsert, tx?: TransactionContext): Promise<string> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT enqueue_vault_render(
        ${data.userId},
        ${data.renderType}::vault_file_type,
        ${data.targetPath ?? null},
        ${data.sourceEventId ?? null},
        ${data.sourceSessionId ?? null},
        ${data.priority ?? 0}
      ) as job_id
    `;
    return result[0]!.job_id;
  }

  async claimRenderJob(tx?: TransactionContext): Promise<RenderJob | null> {
    const db = this.getSql(tx);
    const result = await db`SELECT * FROM claim_vault_render_job()`;

    if (!result[0] || !result[0].job_id) {
      return null;
    }

    return this.findRenderJobById(result[0].job_id, tx);
  }

  async completeRenderJob(
    jobId: string,
    resultFileId?: string | null,
    error?: string | null,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    await db`SELECT complete_vault_render_job(${jobId}, ${resultFileId ?? null}, ${error ?? null})`;
    logger.debug({ jobId, success: !error }, 'Render job completed');
  }

  async retryRenderJob(jobId: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    await db`
      UPDATE vault_render_queue
      SET
        status = 'pending',
        started_at = NULL,
        error = NULL,
        retry_count = retry_count + 1,
        scheduled_at = NOW() + (retry_count * INTERVAL '1 minute')
      WHERE id = ${jobId}
    `;
  }

  async listRenderJobs(
    userId: string,
    filters: RenderJobListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<RenderJob>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, render_type, target_path, source_event_id,
        source_session_id, priority, scheduled_at, status,
        started_at, completed_at, error, retry_count,
        result_file_id, idempotency_key, created_at
      FROM vault_render_queue
      WHERE user_id = ${userId}
        ${filters.status ? db`AND status = ${filters.status}::render_status` : db``}
        ${filters.renderType ? db`AND render_type = ${filters.renderType}::vault_file_type` : db``}
        ${filters.sessionId ? db`AND source_session_id = ${filters.sessionId}` : db``}
      ORDER BY priority DESC, scheduled_at ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapRenderJob(row));

    return { data, hasMore };
  }

  async getPendingRenderJobs(limit: number = 100, tx?: TransactionContext): Promise<RenderJob[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, render_type, target_path, source_event_id,
        source_session_id, priority, scheduled_at, status,
        started_at, completed_at, error, retry_count,
        result_file_id, idempotency_key, created_at
      FROM vault_render_queue
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
      ORDER BY priority DESC, scheduled_at ASC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapRenderJob(row));
  }

  async getFailedRenderJobs(limit: number = 100, tx?: TransactionContext): Promise<RenderJob[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, render_type, target_path, source_event_id,
        source_session_id, priority, scheduled_at, status,
        started_at, completed_at, error, retry_count,
        result_file_id, idempotency_key, created_at
      FROM vault_render_queue
      WHERE status = 'failed'
      ORDER BY completed_at DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapRenderJob(row));
  }

  async countPendingJobs(userId?: string, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT COUNT(*) as count
      FROM vault_render_queue
      WHERE status = 'pending'
        ${userId ? db`AND user_id = ${userId}` : db``}
    `;
    return Number(result[0]?.count ?? 0);
  }

  async cleanupOldJobs(olderThanDays: number = 30, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM vault_render_queue
      WHERE status IN ('completed', 'failed')
        AND completed_at < NOW() - ${olderThanDays + ' days'}::interval
    `;
    return result.count;
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapVaultFile(row: Record<string, unknown>): VaultFileWithMetadata {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      companion_id: row.companion_id as string | null,
      path: row.path as string,
      file_type: row.file_type as VaultFileType,
      content_hash: row.content_hash as string,
      s3_bucket: row.s3_bucket as string,
      s3_key: row.s3_key as string,
      size_bytes: row.size_bytes as number,
      title: row.title as string | null,
      frontmatter: row.frontmatter as JSONObject,
      tags: row.tags as string[],
      source_event_ids: row.source_event_ids as string[],
      sourceSessionId: row.source_session_id as string | null,
      sourceTurnIds: row.source_turn_ids as string[],
      version: row.version as number,
      previousVersionId: row.previous_version_id as string | null,
      lastRenderedAt: row.last_rendered_at as Date,
      renderDurationMs: row.render_duration_ms as number | null,
      metadata: row.frontmatter as JSONObject,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapVaultLink(row: Record<string, unknown>): VaultLink {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      sourceFileId: row.source_file_id as string,
      sourcePath: row.source_path as string,
      targetFileId: row.target_file_id as string | null,
      targetPath: row.target_path as string,
      linkText: row.link_text as string | null,
      linkType: row.link_type as string,
      context: row.context as string | null,
      lineNumber: row.line_number as number | null,
      columnNumber: row.column_number as number | null,
      createdAt: row.created_at as Date,
    };
  }

  private mapRenderJob(row: Record<string, unknown>): RenderJob {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      renderType: row.render_type as VaultFileType,
      targetPath: row.target_path as string | null,
      sourceEventId: row.source_event_id as string | null,
      sourceSessionId: row.source_session_id as string | null,
      priority: row.priority as number,
      scheduledAt: row.scheduled_at as Date,
      status: row.status as RenderStatus,
      startedAt: row.started_at as Date | null,
      completedAt: row.completed_at as Date | null,
      error: row.error as string | null,
      retryCount: row.retry_count as number,
      resultFileId: row.result_file_id as string | null,
      idempotencyKey: row.idempotency_key as string | null,
      createdAt: row.created_at as Date,
    };
  }
}

// Singleton instance
let vaultRepository: VaultRepository | null = null;

export function getVaultRepository(): VaultRepository {
  if (!vaultRepository) {
    vaultRepository = new VaultRepository();
  }
  return vaultRepository;
}
