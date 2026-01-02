/**
 * Admin Settings Repository
 * Data access for admin_settings table (system configuration key-value store)
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type { JSONObject, UUID, Timestamp } from '../db/types.js';
import type { TransactionContext } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export interface AdminSetting {
  key: string;
  value: JSONObject;
  description: string | null;
  updated_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AdminSettingInsert {
  key: string;
  value: JSONObject;
  description?: string | null;
  updated_by?: UUID | null;
}

// ============================================================================
// Repository
// ============================================================================

export class AdminSettingsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Core CRUD Operations
  // ===========================================================================

  /**
   * Get a setting by key
   */
  async get(key: string, tx?: TransactionContext): Promise<AdminSetting | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT key, value, description, updated_by, created_at, updated_at
      FROM admin_settings
      WHERE key = ${key}
    `;

    return result[0] ? this.mapAdminSetting(result[0]) : null;
  }

  /**
   * Get a setting value by key, with type assertion
   */
  async getValue<T = unknown>(key: string, tx?: TransactionContext): Promise<T | null> {
    const setting = await this.get(key, tx);
    if (!setting) {
      return null;
    }
    return setting.value as T;
  }

  /**
   * Get a setting value by key, with a default fallback
   */
  async getValueOrDefault<T = unknown>(
    key: string,
    defaultValue: T,
    tx?: TransactionContext
  ): Promise<T> {
    const value = await this.getValue<T>(key, tx);
    return value ?? defaultValue;
  }

  /**
   * Set a setting value (upsert)
   */
  async set(
    key: string,
    value: JSONObject,
    options: {
      description?: string;
      updatedBy?: UUID;
    } = {},
    tx?: TransactionContext
  ): Promise<AdminSetting> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO admin_settings (key, value, description, updated_by)
        VALUES (
          ${key},
          ${db.json(value as postgres.JSONValue)},
          ${options.description ?? null},
          ${options.updatedBy ?? null}
        )
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          description = COALESCE(EXCLUDED.description, admin_settings.description),
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING key, value, description, updated_by, created_at, updated_at
      `;

      const setting = this.mapAdminSetting(result[0]!);
      logger.debug({ key }, 'Admin setting updated');
      return setting;
    } catch (error) {
      throw wrapDatabaseError(error, 'adminSettings.set');
    }
  }

  /**
   * Delete a setting by key
   */
  async delete(key: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM admin_settings
      WHERE key = ${key}
      RETURNING key
    `;

    if (!result[0]) {
      throw new NotFoundError('AdminSetting', key);
    }

    logger.debug({ key }, 'Admin setting deleted');
  }

  /**
   * Get all settings
   */
  async getAll(tx?: TransactionContext): Promise<AdminSetting[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT key, value, description, updated_by, created_at, updated_at
      FROM admin_settings
      ORDER BY key ASC
    `;

    return result.map(row => this.mapAdminSetting(row));
  }

  /**
   * Get settings by key prefix
   */
  async getByPrefix(prefix: string, tx?: TransactionContext): Promise<AdminSetting[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT key, value, description, updated_by, created_at, updated_at
      FROM admin_settings
      WHERE key LIKE ${prefix + '%'}
      ORDER BY key ASC
    `;

    return result.map(row => this.mapAdminSetting(row));
  }

  /**
   * Check if a setting exists
   */
  async exists(key: string, tx?: TransactionContext): Promise<boolean> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT 1 FROM admin_settings WHERE key = ${key}
    `;

    return result.length > 0;
  }

  // ===========================================================================
  // Row Mapper
  // ===========================================================================

  private mapAdminSetting(row: Record<string, unknown>): AdminSetting {
    return {
      key: row['key'] as string,
      value: row['value'] as JSONObject,
      description: row['description'] as string | null,
      updated_by: row['updated_by'] as UUID | null,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
    };
  }
}

// Singleton instance
let adminSettingsRepositoryInstance: AdminSettingsRepository | null = null;

export function getAdminSettingsRepository(): AdminSettingsRepository {
  if (!adminSettingsRepositoryInstance) {
    adminSettingsRepositoryInstance = new AdminSettingsRepository();
  }
  return adminSettingsRepositoryInstance;
}
