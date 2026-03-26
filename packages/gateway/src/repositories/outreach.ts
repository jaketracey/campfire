/**
 * Outreach Repository
 * Data access for outreach_records and outreach_config tables.
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { UUID, JSONObject } from '../db/types.js';
import type { TransactionContext } from './types.js';
import { wrapDatabaseError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export type OutreachTrigger =
  | 'scheduled_checkin'
  | 'followup'
  | 'time_based'
  | 'emotional_support'
  | 'milestone';

export type DeliveryChannel =
  | 'websocket'
  | 'push'
  | 'telegram'
  | 'discord'
  | 'stored';

export interface OutreachRecord {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  trigger: OutreachTrigger;
  message: string;
  delivered_via: DeliveryChannel;
  delivered_at: Date | null;
  was_opened: boolean;
  led_to_conversation: boolean;
  session_id: UUID | null;
  metadata: JSONObject;
  created_at: Date;
}

export interface OutreachRecordInsert {
  user_id: UUID;
  companion_id: UUID;
  trigger: OutreachTrigger;
  message: string;
  delivered_via?: DeliveryChannel;
  metadata?: JSONObject;
}

export interface OutreachConfig {
  companion_id: UUID;
  enabled: boolean;
  min_interval_hours: number;
  max_daily: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  triggers_enabled: OutreachTrigger[];
  updated_at: Date;
  created_at: Date;
}

export interface OutreachConfigUpdate {
  enabled?: boolean;
  min_interval_hours?: number;
  max_daily?: number;
  quiet_hours_start?: number;
  quiet_hours_end?: number;
  triggers_enabled?: OutreachTrigger[];
}

// ============================================================================
// Repository
// ============================================================================

export class OutreachRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Outreach Records
  // ===========================================================================

  /**
   * Create a new outreach record.
   */
  async createRecord(
    data: OutreachRecordInsert,
    tx?: TransactionContext
  ): Promise<OutreachRecord> {
    const db = this.getSql(tx);

    try {
      const [record] = await db`
        INSERT INTO outreach_records (
          user_id,
          companion_id,
          trigger,
          message,
          delivered_via,
          metadata
        ) VALUES (
          ${data.user_id},
          ${data.companion_id},
          ${data.trigger},
          ${data.message},
          ${data.delivered_via || 'stored'},
          ${JSON.stringify(data.metadata || {})}
        )
        RETURNING *
      `;
      return record as unknown as OutreachRecord;
    } catch (error) {
      throw wrapDatabaseError(error, 'createOutreachRecord');
    }
  }

  /**
   * Get pending (undelivered) outreach records for a user.
   */
  async getPending(
    userId: UUID,
    tx?: TransactionContext
  ): Promise<OutreachRecord[]> {
    const db = this.getSql(tx);

    try {
      const records = await db`
        SELECT *
        FROM outreach_records
        WHERE user_id = ${userId}
          AND delivered_at IS NULL
        ORDER BY created_at ASC
      `;
      return records as unknown as OutreachRecord[];
    } catch (error) {
      throw wrapDatabaseError(error, 'getPendingOutreach');
    }
  }

  /**
   * Mark an outreach record as delivered.
   */
  async markDelivered(
    id: UUID,
    deliveryChannel: DeliveryChannel,
    tx?: TransactionContext
  ): Promise<OutreachRecord | null> {
    const db = this.getSql(tx);

    try {
      const [record] = await db`
        UPDATE outreach_records
        SET
          delivered_at = NOW(),
          delivered_via = ${deliveryChannel}
        WHERE id = ${id}
          AND delivered_at IS NULL
        RETURNING *
      `;
      return (record as unknown as OutreachRecord) || null;
    } catch (error) {
      throw wrapDatabaseError(error, 'markOutreachDelivered');
    }
  }

  /**
   * Mark an outreach record as opened by the user.
   */
  async markOpened(
    id: UUID,
    tx?: TransactionContext
  ): Promise<OutreachRecord | null> {
    const db = this.getSql(tx);

    try {
      const [record] = await db`
        UPDATE outreach_records
        SET was_opened = TRUE
        WHERE id = ${id}
        RETURNING *
      `;
      return (record as unknown as OutreachRecord) || null;
    } catch (error) {
      throw wrapDatabaseError(error, 'markOutreachOpened');
    }
  }

  /**
   * Mark that an outreach led to a conversation.
   */
  async markConversation(
    id: UUID,
    sessionId: UUID,
    tx?: TransactionContext
  ): Promise<OutreachRecord | null> {
    const db = this.getSql(tx);

    try {
      const [record] = await db`
        UPDATE outreach_records
        SET
          led_to_conversation = TRUE,
          session_id = ${sessionId}
        WHERE id = ${id}
        RETURNING *
      `;
      return (record as unknown as OutreachRecord) || null;
    } catch (error) {
      throw wrapDatabaseError(error, 'markOutreachConversation');
    }
  }

  /**
   * Count outreach records for a user-companion pair today.
   */
  async countTodayForPair(
    userId: UUID,
    companionId: UUID,
    tx?: TransactionContext
  ): Promise<number> {
    const db = this.getSql(tx);

    try {
      const [result] = await db`
        SELECT COUNT(*)::int AS count
        FROM outreach_records
        WHERE user_id = ${userId}
          AND companion_id = ${companionId}
          AND created_at >= CURRENT_DATE
      `;
      return (result as unknown as { count: number }).count;
    } catch (error) {
      throw wrapDatabaseError(error, 'countTodayOutreach');
    }
  }

  /**
   * Get the most recent outreach record for a user-companion pair.
   */
  async getLastForPair(
    userId: UUID,
    companionId: UUID,
    tx?: TransactionContext
  ): Promise<OutreachRecord | null> {
    const db = this.getSql(tx);

    try {
      const [record] = await db`
        SELECT *
        FROM outreach_records
        WHERE user_id = ${userId}
          AND companion_id = ${companionId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      return (record as unknown as OutreachRecord) || null;
    } catch (error) {
      throw wrapDatabaseError(error, 'getLastOutreach');
    }
  }

  // ===========================================================================
  // Eligibility Check (used by orchestrator via internal endpoint)
  // ===========================================================================

  /**
   * Check if a user-companion pair is eligible for outreach.
   */
  async checkEligibility(
    userId: UUID,
    companionId: UUID,
    minIntervalHours: number,
    maxDaily: number,
    tx?: TransactionContext
  ): Promise<{ eligible: boolean; reason: string }> {
    const db = this.getSql(tx);

    try {
      // Check if user has ever interacted with this companion
      const [sessionCheck] = await db`
        SELECT COUNT(*)::int AS count
        FROM sessions
        WHERE user_id = ${userId}
          AND companion_id = ${companionId}
      `;
      if ((sessionCheck as unknown as { count: number }).count === 0) {
        return { eligible: false, reason: 'No previous interaction' };
      }

      // Check minimum interval since last outreach
      const cutoff = new Date(Date.now() - minIntervalHours * 60 * 60 * 1000);
      const [recentCheck] = await db`
        SELECT COUNT(*)::int AS count
        FROM outreach_records
        WHERE user_id = ${userId}
          AND companion_id = ${companionId}
          AND created_at > ${cutoff.toISOString()}
      `;
      if ((recentCheck as unknown as { count: number }).count > 0) {
        return { eligible: false, reason: 'Too soon since last outreach' };
      }

      // Check max daily limit
      const [dailyCheck] = await db`
        SELECT COUNT(*)::int AS count
        FROM outreach_records
        WHERE user_id = ${userId}
          AND companion_id = ${companionId}
          AND created_at >= CURRENT_DATE
      `;
      if ((dailyCheck as unknown as { count: number }).count >= maxDaily) {
        return { eligible: false, reason: 'Daily outreach limit reached' };
      }

      // Check if user has muted this companion (via outreach_config or companion settings)
      const [configCheck] = await db`
        SELECT enabled
        FROM outreach_config
        WHERE companion_id = ${companionId}
      `;
      if (configCheck && !(configCheck as unknown as { enabled: boolean }).enabled) {
        return { eligible: false, reason: 'Outreach disabled for companion' };
      }

      return { eligible: true, reason: '' };
    } catch (error) {
      throw wrapDatabaseError(error, 'checkOutreachEligibility');
    }
  }

  // ===========================================================================
  // Outreach Config
  // ===========================================================================

  /**
   * Get outreach config for a companion (returns null if using defaults).
   */
  async getConfig(
    companionId: UUID,
    tx?: TransactionContext
  ): Promise<OutreachConfig | null> {
    const db = this.getSql(tx);

    try {
      const [config] = await db`
        SELECT *
        FROM outreach_config
        WHERE companion_id = ${companionId}
      `;
      if (!config) return null;
      const raw = config as unknown as Record<string, unknown>;
      return {
        ...raw,
        triggers_enabled: Array.isArray(raw.triggers_enabled)
          ? raw.triggers_enabled
          : JSON.parse(raw.triggers_enabled as string),
      } as unknown as OutreachConfig;
    } catch (error) {
      throw wrapDatabaseError(error, 'getOutreachConfig');
    }
  }

  /**
   * Upsert outreach config for a companion.
   */
  async upsertConfig(
    companionId: UUID,
    update: OutreachConfigUpdate,
    tx?: TransactionContext
  ): Promise<OutreachConfig> {
    const db = this.getSql(tx);

    try {
      const triggersJson = update.triggers_enabled
        ? JSON.stringify(update.triggers_enabled)
        : undefined;

      const [config] = await db`
        INSERT INTO outreach_config (
          companion_id,
          enabled,
          min_interval_hours,
          max_daily,
          quiet_hours_start,
          quiet_hours_end,
          triggers_enabled
        ) VALUES (
          ${companionId},
          ${update.enabled ?? true},
          ${update.min_interval_hours ?? 24},
          ${update.max_daily ?? 1},
          ${update.quiet_hours_start ?? 22},
          ${update.quiet_hours_end ?? 8},
          ${triggersJson ?? '["scheduled_checkin", "followup", "time_based"]'}
        )
        ON CONFLICT (companion_id) DO UPDATE SET
          enabled = COALESCE(${update.enabled ?? null}, outreach_config.enabled),
          min_interval_hours = COALESCE(${update.min_interval_hours ?? null}, outreach_config.min_interval_hours),
          max_daily = COALESCE(${update.max_daily ?? null}, outreach_config.max_daily),
          quiet_hours_start = COALESCE(${update.quiet_hours_start ?? null}, outreach_config.quiet_hours_start),
          quiet_hours_end = COALESCE(${update.quiet_hours_end ?? null}, outreach_config.quiet_hours_end),
          triggers_enabled = COALESCE(${triggersJson ?? null}::jsonb, outreach_config.triggers_enabled),
          updated_at = NOW()
        RETURNING *
      `;
      const raw = config as unknown as Record<string, unknown>;
      return {
        ...raw,
        triggers_enabled: Array.isArray(raw.triggers_enabled)
          ? raw.triggers_enabled
          : JSON.parse(raw.triggers_enabled as string),
      } as unknown as OutreachConfig;
    } catch (error) {
      throw wrapDatabaseError(error, 'upsertOutreachConfig');
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: OutreachRepository | null = null;

export function getOutreachRepository(): OutreachRepository {
  if (!instance) {
    instance = new OutreachRepository();
  }
  return instance;
}
