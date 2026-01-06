/**
 * Creator Earnings Repository
 * Data access for token_spend_attributions and creator_earnings tables
 */

import postgres from 'postgres';
import { sql } from '../db/pool.js';
import type { UUID, Timestamp } from '../db/types.js';
import type { TransactionContext } from './types.js';
import { wrapDatabaseError } from './errors.js';

export type TokenSpendFeature = 'gift' | 'voice_call' | 'video' | 'other';

export interface TokenSpendAttributionInsert {
  token_transaction_id: UUID;
  spender_user_id: UUID;
  creator_user_id: UUID;
  companion_id: UUID;
  session_id?: UUID | null;
  feature: TokenSpendFeature;
  tokens_spent: number;
  metadata?: Record<string, unknown>;
}

export interface CreatorEarningInsert {
  token_transaction_id: UUID;
  creator_user_id: UUID;
  companion_id: UUID;
  spender_user_id: UUID;
  feature: TokenSpendFeature;
  tokens_spent: number;
  gross_cents: number;
  platform_fee_cents: number;
  net_cents: number;
}

export interface CreatorEarningRow {
  id: UUID;
  token_transaction_id: UUID;
  creator_user_id: UUID;
  companion_id: UUID;
  spender_user_id: UUID;
  feature: TokenSpendFeature;
  tokens_spent: number;
  gross_cents: number;
  platform_fee_cents: number;
  net_cents: number;
  created_at: Timestamp;
}

export interface CreatorEarningsSummary {
  total_net_cents: number;
  total_gross_cents: number;
  total_platform_fee_cents: number;
  total_tokens_spent: number;
  earnings_count: number;
}

export class CreatorEarningsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  async upsertAttribution(
    input: TokenSpendAttributionInsert,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    try {
      await db`
        INSERT INTO token_spend_attributions (
          token_transaction_id, spender_user_id, creator_user_id,
          companion_id, session_id, feature, tokens_spent, metadata
        ) VALUES (
          ${input.token_transaction_id},
          ${input.spender_user_id},
          ${input.creator_user_id},
          ${input.companion_id},
          ${input.session_id ?? null},
          ${input.feature}::token_spend_feature,
          ${input.tokens_spent},
          ${db.json((input.metadata ?? {}) as postgres.JSONValue)}
        )
        ON CONFLICT (token_transaction_id) DO NOTHING
      `;
    } catch (error) {
      throw wrapDatabaseError(error, 'creatorEarnings.upsertAttribution');
    }
  }

  async upsertEarning(
    input: CreatorEarningInsert,
    tx?: TransactionContext
  ): Promise<void> {
    const db = this.getSql(tx);
    try {
      await db`
        INSERT INTO creator_earnings (
          token_transaction_id, creator_user_id, companion_id, spender_user_id,
          feature, tokens_spent, gross_cents, platform_fee_cents, net_cents
        ) VALUES (
          ${input.token_transaction_id},
          ${input.creator_user_id},
          ${input.companion_id},
          ${input.spender_user_id},
          ${input.feature}::token_spend_feature,
          ${input.tokens_spent},
          ${input.gross_cents},
          ${input.platform_fee_cents},
          ${input.net_cents}
        )
        ON CONFLICT (token_transaction_id) DO NOTHING
      `;
    } catch (error) {
      throw wrapDatabaseError(error, 'creatorEarnings.upsertEarning');
    }
  }

  async getSummaryForCreator(
    creatorUserId: UUID,
    tx?: TransactionContext
  ): Promise<CreatorEarningsSummary> {
    const db = this.getSql(tx);
    try {
      const rows = await db`
        SELECT
          COALESCE(SUM(net_cents), 0) as total_net_cents,
          COALESCE(SUM(gross_cents), 0) as total_gross_cents,
          COALESCE(SUM(platform_fee_cents), 0) as total_platform_fee_cents,
          COALESCE(SUM(tokens_spent), 0) as total_tokens_spent,
          COUNT(*)::int as earnings_count
        FROM creator_earnings
        WHERE creator_user_id = ${creatorUserId}
      `;
      const row = rows[0]!;
      return {
        total_net_cents: Number(row.total_net_cents) || 0,
        total_gross_cents: Number(row.total_gross_cents) || 0,
        total_platform_fee_cents: Number(row.total_platform_fee_cents) || 0,
        total_tokens_spent: Number(row.total_tokens_spent) || 0,
        earnings_count: Number(row.earnings_count) || 0,
      };
    } catch (error) {
      throw wrapDatabaseError(error, 'creatorEarnings.getSummaryForCreator');
    }
  }
}

let creatorEarningsRepository: CreatorEarningsRepository | null = null;
export function getCreatorEarningsRepository(): CreatorEarningsRepository {
  creatorEarningsRepository ??= new CreatorEarningsRepository();
  return creatorEarningsRepository;
}
