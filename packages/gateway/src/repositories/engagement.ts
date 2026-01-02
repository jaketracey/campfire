/**
 * Engagement Repository
 * Data access for engagement_signals table and engagement-related operations
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type {
  UUID,
  EngagementSignal,
  EngagementSignalInsert,
  EngagementConfig,
  AnonymousUsageWithEngagement,
} from '../db/types.js';
import type { TransactionContext } from './types.js';
import { wrapDatabaseError } from './errors.js';
import { getAdminSettingsRepository } from './admin-settings.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONVERSION_THRESHOLD = 70;
const DEFAULT_MIN_MESSAGES = 3;
const DEFAULT_MAX_MESSAGES = 10;

// ============================================================================
// Repository
// ============================================================================

export class EngagementRepository {
  private adminSettings = getAdminSettingsRepository();

  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Signal Recording
  // ===========================================================================

  /**
   * Record an engagement signal for a message
   */
  async recordSignal(
    data: EngagementSignalInsert,
    tx?: TransactionContext
  ): Promise<EngagementSignal> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO engagement_signals (
          anonymous_usage_id,
          session_id,
          message_number,
          sentiment_score,
          personal_pronoun_density,
          vulnerability_score,
          emotional_language_score,
          message_length_score,
          question_engagement_score,
          topic_depth_score,
          response_time_score,
          emotional_depth_score,
          investment_score,
          combined_score,
          message_length,
          word_count,
          question_count,
          response_time_ms
        )
        VALUES (
          ${data.anonymous_usage_id},
          ${data.session_id ?? null},
          ${data.message_number},
          ${data.sentiment_score},
          ${data.personal_pronoun_density},
          ${data.vulnerability_score},
          ${data.emotional_language_score},
          ${data.message_length_score},
          ${data.question_engagement_score},
          ${data.topic_depth_score},
          ${data.response_time_score},
          ${data.emotional_depth_score},
          ${data.investment_score},
          ${data.combined_score},
          ${data.message_length},
          ${data.word_count},
          ${data.question_count},
          ${data.response_time_ms ?? null}
        )
        RETURNING *
      `;

      const signal = this.mapEngagementSignal(result[0]!);
      logger.debug(
        {
          anonymousUsageId: data.anonymous_usage_id,
          messageNumber: data.message_number,
          combinedScore: data.combined_score,
        },
        'Engagement signal recorded'
      );
      return signal;
    } catch (error) {
      throw wrapDatabaseError(error, 'engagement.recordSignal');
    }
  }

  // ===========================================================================
  // Signal Retrieval
  // ===========================================================================

  /**
   * Get all engagement signals for an anonymous usage record
   */
  async getSignalsByUsage(
    anonymousUsageId: UUID,
    tx?: TransactionContext
  ): Promise<EngagementSignal[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT *
      FROM engagement_signals
      WHERE anonymous_usage_id = ${anonymousUsageId}
      ORDER BY message_number ASC
    `;

    return result.map(row => this.mapEngagementSignal(row));
  }

  /**
   * Get the most recent engagement signal for an anonymous usage record
   */
  async getLatestSignal(
    anonymousUsageId: UUID,
    tx?: TransactionContext
  ): Promise<EngagementSignal | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT *
      FROM engagement_signals
      WHERE anonymous_usage_id = ${anonymousUsageId}
      ORDER BY message_number DESC
      LIMIT 1
    `;

    return result[0] ? this.mapEngagementSignal(result[0]) : null;
  }

  // ===========================================================================
  // Score Management
  // ===========================================================================

  /**
   * Update the cumulative engagement score on anonymous_usage
   */
  async updateCumulativeScore(
    anonymousUsageId: UUID,
    score: number,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE anonymous_usage
      SET
        engagement_score = ${Math.round(score)},
        peak_engagement_score = GREATEST(peak_engagement_score, ${Math.round(score)}),
        last_seen_at = NOW()
      WHERE id = ${anonymousUsageId}
    `;

    logger.debug({ anonymousUsageId, score: Math.round(score) }, 'Engagement score updated');
  }

  /**
   * Mark that conversion was triggered for this anonymous user
   */
  async markConversionTriggered(
    anonymousUsageId: UUID,
    messageNumber: number,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);

    await db`
      UPDATE anonymous_usage
      SET
        conversion_triggered_at = NOW(),
        conversion_trigger_message = ${messageNumber}
      WHERE id = ${anonymousUsageId}
        AND conversion_triggered_at IS NULL
    `;

    logger.info({ anonymousUsageId, messageNumber }, 'Conversion triggered for anonymous user');
  }

  /**
   * Get anonymous usage with engagement fields
   */
  async getUsageWithEngagement(
    fingerprint: string,
    tx?: TransactionContext
  ): Promise<AnonymousUsageWithEngagement | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        id,
        device_fingerprint,
        ip_address,
        messages_used,
        last_session_id,
        first_seen_at,
        last_seen_at,
        converted_user_id,
        engagement_score,
        peak_engagement_score,
        conversion_triggered_at,
        conversion_trigger_message
      FROM anonymous_usage
      WHERE device_fingerprint = ${fingerprint}
    `;

    return result[0] ? this.mapAnonymousUsageWithEngagement(result[0]) : null;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Get engagement configuration from admin settings
   */
  async getConfig(tx?: TransactionContext): Promise<EngagementConfig> {
    const [thresholdSetting, minSetting, maxSetting] = await Promise.all([
      this.adminSettings.getValue<{ value: number }>('engagement_conversion_threshold', tx),
      this.adminSettings.getValue<{ value: number }>('engagement_min_messages', tx),
      this.adminSettings.getValue<{ value: number }>('engagement_max_messages', tx),
    ]);

    return {
      conversionThreshold: thresholdSetting?.value ?? DEFAULT_CONVERSION_THRESHOLD,
      minMessages: minSetting?.value ?? DEFAULT_MIN_MESSAGES,
      maxMessages: maxSetting?.value ?? DEFAULT_MAX_MESSAGES,
    };
  }

  // ===========================================================================
  // Analytics
  // ===========================================================================

  /**
   * Get engagement statistics for analytics
   */
  async getEngagementStats(tx?: TransactionContext): Promise<{
    averageConversionScore: number;
    averageMessagesBeforeConversion: number;
    conversionsByEngagementVsMax: { engagement: number; maxMessages: number };
  }> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        COALESCE(AVG(CASE WHEN conversion_triggered_at IS NOT NULL THEN engagement_score END), 0) as avg_conversion_score,
        COALESCE(AVG(CASE WHEN conversion_triggered_at IS NOT NULL THEN conversion_trigger_message END), 0) as avg_messages,
        COUNT(CASE WHEN conversion_triggered_at IS NOT NULL AND conversion_trigger_message < 10 THEN 1 END) as engagement_conversions,
        COUNT(CASE WHEN conversion_triggered_at IS NOT NULL AND conversion_trigger_message >= 10 THEN 1 END) as max_message_conversions
      FROM anonymous_usage
      WHERE conversion_triggered_at IS NOT NULL
    `;

    const row = result[0]!;
    return {
      averageConversionScore: Number(row['avg_conversion_score']) || 0,
      averageMessagesBeforeConversion: Number(row['avg_messages']) || 0,
      conversionsByEngagementVsMax: {
        engagement: Number(row['engagement_conversions']) || 0,
        maxMessages: Number(row['max_message_conversions']) || 0,
      },
    };
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapEngagementSignal(row: Record<string, unknown>): EngagementSignal {
    return {
      id: row['id'] as string,
      anonymous_usage_id: row['anonymous_usage_id'] as string,
      session_id: row['session_id'] as string | null,
      message_number: row['message_number'] as number,
      sentiment_score: row['sentiment_score'] as number,
      personal_pronoun_density: row['personal_pronoun_density'] as number,
      vulnerability_score: row['vulnerability_score'] as number,
      emotional_language_score: row['emotional_language_score'] as number,
      message_length_score: row['message_length_score'] as number,
      question_engagement_score: row['question_engagement_score'] as number,
      topic_depth_score: row['topic_depth_score'] as number,
      response_time_score: row['response_time_score'] as number,
      emotional_depth_score: row['emotional_depth_score'] as number,
      investment_score: row['investment_score'] as number,
      combined_score: row['combined_score'] as number,
      message_length: row['message_length'] as number,
      word_count: row['word_count'] as number,
      question_count: row['question_count'] as number,
      response_time_ms: row['response_time_ms'] as number | null,
      created_at: row['created_at'] as Date,
    };
  }

  private mapAnonymousUsageWithEngagement(
    row: Record<string, unknown>
  ): AnonymousUsageWithEngagement {
    return {
      id: row['id'] as string,
      device_fingerprint: row['device_fingerprint'] as string,
      ip_address: row['ip_address'] as string | null,
      messages_used: row['messages_used'] as number,
      last_session_id: row['last_session_id'] as string | null,
      first_seen_at: row['first_seen_at'] as Date,
      last_seen_at: row['last_seen_at'] as Date,
      converted_user_id: row['converted_user_id'] as string | null,
      engagement_score: row['engagement_score'] as number,
      peak_engagement_score: row['peak_engagement_score'] as number,
      conversion_triggered_at: row['conversion_triggered_at'] as Date | null,
      conversion_trigger_message: row['conversion_trigger_message'] as number | null,
    };
  }
}

// Singleton instance
let engagementRepositoryInstance: EngagementRepository | null = null;

export function getEngagementRepository(): EngagementRepository {
  if (!engagementRepositoryInstance) {
    engagementRepositoryInstance = new EngagementRepository();
  }
  return engagementRepositoryInstance;
}
