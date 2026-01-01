/**
 * Gifts Repository
 * Data access for token balances, transactions, bundles, gifts, and gift memories
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type {
  TokenBalance,
  TokenTransaction,
  TokenTransactionType,
  TokenBundle,
  TokenBundleInsert,
  Gift,
  GiftInsert,
  GiftStatus,
  GiftMemory,
  GiftMemoryInsert,
  JSONObject,
} from '../db/types.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, isUniqueViolation, wrapDatabaseError, validateUuid } from './errors.js';

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Token balance with computed fields
 */
export interface TokenBalanceWithStats extends TokenBalance {
  totalTokens: number;
}

/**
 * Gift with companion info
 */
export interface GiftWithDetails extends Gift {
  companionName?: string;
}

/**
 * Gift memory with gift info
 */
export interface GiftMemoryWithGift extends GiftMemory {
  giftName: string;
  giftImageUrl: string | null;
}

/**
 * Credit tokens result
 */
export interface CreditTokensResult {
  transactionId: string;
  newBalance: number;
  wasDuplicate: boolean;
}

/**
 * Deduct tokens result
 */
export interface DeductTokensResult {
  success: boolean;
  transactionId: string | null;
  newBalance: number;
  errorMessage: string | null;
}

/**
 * Token transaction list filters
 */
export interface TokenTransactionListFilters extends PaginationOptions {
  transactionType?: TokenTransactionType;
  giftId?: string;
}

/**
 * Gift list filters
 */
export interface GiftListFilters extends PaginationOptions {
  status?: GiftStatus | GiftStatus[];
  companionId?: string;
}

/**
 * Gift memory search result
 */
export interface GiftMemorySearchResult extends GiftMemory {
  similarity: number;
  giftName: string;
  giftImageUrl: string | null;
}

// ============================================================================
// Repository
// ============================================================================

export class GiftsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Token Balance
  // ===========================================================================

  async getTokenBalance(userId: string, tx?: TransactionContext): Promise<TokenBalance | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, balance, lifetime_purchased, lifetime_bonus,
        lifetime_spent, current_period_bonus, bonus_granted_at,
        created_at, updated_at
      FROM token_balances
      WHERE user_id = ${userId}
    `;

    return result[0] ? this.mapTokenBalance(result[0]) : null;
  }

  async getOrCreateTokenBalance(userId: string, tx?: TransactionContext): Promise<TokenBalance> {
    const db = this.getSql(tx);

    // Try to insert, or get existing
    const result = await db`
      INSERT INTO token_balances (user_id, balance)
      VALUES (${userId}, 0)
      ON CONFLICT (user_id) DO UPDATE SET user_id = token_balances.user_id
      RETURNING
        id, user_id, balance, lifetime_purchased, lifetime_bonus,
        lifetime_spent, current_period_bonus, bonus_granted_at,
        created_at, updated_at
    `;

    return this.mapTokenBalance(result[0]!);
  }

  async creditTokens(
    userId: string,
    amount: number,
    type: TokenTransactionType,
    options: {
      stripePaymentIntentId?: string;
      stripeCheckoutSessionId?: string;
      subscriptionId?: string;
      description?: string;
      metadata?: JSONObject;
      idempotencyKey?: string;
    } = {},
    tx?: TransactionContext
  ): Promise<CreditTokensResult> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM credit_tokens(
        ${userId},
        ${amount},
        ${type}::token_transaction_type,
        ${options.stripePaymentIntentId ?? null},
        ${options.stripeCheckoutSessionId ?? null},
        ${options.subscriptionId ?? null},
        ${options.description ?? null},
        ${db.json((options.metadata ?? {}) as postgres.JSONValue)},
        ${options.idempotencyKey ?? null}
      )
    `;

    const row = result[0]!;
    logger.debug(
      { userId, amount, type, wasDuplicate: row.was_duplicate },
      'Tokens credited'
    );

    return {
      transactionId: row.transaction_id,
      newBalance: row.new_balance,
      wasDuplicate: row.was_duplicate,
    };
  }

  async deductTokens(
    userId: string,
    amount: number,
    giftId: string,
    description?: string,
    tx?: TransactionContext
  ): Promise<DeductTokensResult> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM deduct_tokens(
        ${userId},
        ${amount},
        ${giftId},
        ${description ?? null}
      )
    `;

    const row = result[0]!;

    if (row.success) {
      logger.debug({ userId, amount, giftId }, 'Tokens deducted');
    } else {
      logger.warn({ userId, amount, giftId, error: row.error_message }, 'Token deduction failed');
    }

    return {
      success: row.success,
      transactionId: row.transaction_id,
      newBalance: row.new_balance ?? 0,
      errorMessage: row.error_message,
    };
  }

  // ===========================================================================
  // Token Transactions
  // ===========================================================================

  async listTokenTransactions(
    userId: string,
    filters: TokenTransactionListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<TokenTransaction>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, transaction_type, amount, balance_after,
        stripe_payment_intent_id, stripe_checkout_session_id,
        gift_id, subscription_id, description, metadata,
        idempotency_key, created_at
      FROM token_transactions
      WHERE user_id = ${userId}
        ${filters.transactionType ? db`AND transaction_type = ${filters.transactionType}` : db``}
        ${filters.giftId ? db`AND gift_id = ${filters.giftId}` : db``}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapTokenTransaction(row));

    return { data, hasMore };
  }

  async findTransactionByIdempotencyKey(
    idempotencyKey: string,
    tx?: TransactionContext
  ): Promise<TokenTransaction | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, transaction_type, amount, balance_after,
        stripe_payment_intent_id, stripe_checkout_session_id,
        gift_id, subscription_id, description, metadata,
        idempotency_key, created_at
      FROM token_transactions
      WHERE idempotency_key = ${idempotencyKey}
    `;

    return result[0] ? this.mapTokenTransaction(result[0]) : null;
  }

  // ===========================================================================
  // Token Bundles
  // ===========================================================================

  async listActiveBundles(tx?: TransactionContext): Promise<TokenBundle[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, description, tokens, price_cents, currency,
        stripe_price_id, stripe_product_id, is_active, display_order,
        bonus_tokens, bonus_expires_at, created_at, updated_at
      FROM token_bundles
      WHERE is_active = TRUE
      ORDER BY display_order ASC, price_cents ASC
    `;

    return result.map(row => this.mapTokenBundle(row));
  }

  async findBundleById(id: string, tx?: TransactionContext): Promise<TokenBundle | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, description, tokens, price_cents, currency,
        stripe_price_id, stripe_product_id, is_active, display_order,
        bonus_tokens, bonus_expires_at, created_at, updated_at
      FROM token_bundles
      WHERE id = ${id}
    `;

    return result[0] ? this.mapTokenBundle(result[0]) : null;
  }

  async findBundleByStripePrice(
    stripePriceId: string,
    tx?: TransactionContext
  ): Promise<TokenBundle | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, description, tokens, price_cents, currency,
        stripe_price_id, stripe_product_id, is_active, display_order,
        bonus_tokens, bonus_expires_at, created_at, updated_at
      FROM token_bundles
      WHERE stripe_price_id = ${stripePriceId}
    `;

    return result[0] ? this.mapTokenBundle(result[0]) : null;
  }

  async createBundle(data: TokenBundleInsert, tx?: TransactionContext): Promise<TokenBundle> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO token_bundles (
          name, description, tokens, price_cents, currency,
          stripe_price_id, stripe_product_id, is_active, display_order,
          bonus_tokens, bonus_expires_at
        ) VALUES (
          ${data.name},
          ${data.description ?? null},
          ${data.tokens},
          ${data.price_cents},
          ${data.currency ?? 'usd'},
          ${data.stripe_price_id ?? null},
          ${data.stripe_product_id ?? null},
          ${data.is_active ?? true},
          ${data.display_order ?? 0},
          ${data.bonus_tokens ?? 0},
          ${data.bonus_expires_at ?? null}
        )
        RETURNING
          id, name, description, tokens, price_cents, currency,
          stripe_price_id, stripe_product_id, is_active, display_order,
          bonus_tokens, bonus_expires_at, created_at, updated_at
      `;

      const bundle = this.mapTokenBundle(result[0]!);
      logger.debug({ bundleId: bundle.id, name: data.name }, 'Token bundle created');
      return bundle;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('TokenBundle', 'stripe_price_id', data.stripe_price_id ?? '');
      }
      throw wrapDatabaseError(error, 'gifts.createBundle');
    }
  }

  async updateBundle(
    id: string,
    data: Partial<TokenBundleInsert>,
    tx?: TransactionContext
  ): Promise<TokenBundle> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE token_bundles
      SET
        name = COALESCE(${data.name ?? null}, name),
        description = COALESCE(${data.description ?? null}, description),
        tokens = COALESCE(${data.tokens ?? null}, tokens),
        price_cents = COALESCE(${data.price_cents ?? null}, price_cents),
        currency = COALESCE(${data.currency ?? null}, currency),
        stripe_price_id = COALESCE(${data.stripe_price_id ?? null}, stripe_price_id),
        stripe_product_id = COALESCE(${data.stripe_product_id ?? null}, stripe_product_id),
        is_active = COALESCE(${data.is_active ?? null}, is_active),
        display_order = COALESCE(${data.display_order ?? null}, display_order),
        bonus_tokens = COALESCE(${data.bonus_tokens ?? null}, bonus_tokens),
        bonus_expires_at = COALESCE(${data.bonus_expires_at ?? null}, bonus_expires_at)
      WHERE id = ${id}
      RETURNING
        id, name, description, tokens, price_cents, currency,
        stripe_price_id, stripe_product_id, is_active, display_order,
        bonus_tokens, bonus_expires_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('TokenBundle', id);
    }

    logger.debug({ bundleId: id }, 'Token bundle updated');
    return this.mapTokenBundle(result[0]);
  }

  // ===========================================================================
  // Gifts
  // ===========================================================================

  async createGift(data: GiftInsert, tx?: TransactionContext): Promise<Gift> {
    // Validate UUID formats before inserting
    validateUuid(data.user_id, 'user_id');
    validateUuid(data.companion_id, 'companion_id');

    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO gifts (
        user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, token_cost, status, generation_params,
        source_event_id, source_turn_id
      ) VALUES (
        ${data.user_id},
        ${data.companion_id},
        ${data.name},
        ${data.description ?? null},
        ${data.visual_prompt ?? null},
        ${data.emotional_meaning ?? null},
        ${data.token_cost},
        ${data.status ?? 'generating'},
        ${data.generation_params ? db.json(data.generation_params as postgres.JSONValue) : null},
        ${data.source_event_id ?? null},
        ${data.source_turn_id ?? null}
      )
      RETURNING
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
    `;

    const gift = this.mapGift(result[0]!);
    logger.debug({ giftId: gift.id, userId: data.user_id, companionId: data.companion_id }, 'Gift created');
    return gift;
  }

  async findGiftById(id: string, tx?: TransactionContext): Promise<Gift | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
      FROM gifts
      WHERE id = ${id}
    `;

    return result[0] ? this.mapGift(result[0]) : null;
  }

  async findGiftByIdWithOwnerCheck(
    id: string,
    userId: string,
    tx?: TransactionContext
  ): Promise<Gift | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
      FROM gifts
      WHERE id = ${id} AND user_id = ${userId}
    `;

    return result[0] ? this.mapGift(result[0]) : null;
  }

  async updateGiftStatus(
    id: string,
    status: GiftStatus,
    error?: string,
    tx?: TransactionContext
  ): Promise<Gift> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE gifts
      SET
        status = ${status},
        generation_error = ${error ?? null}
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Gift', id);
    }

    logger.debug({ giftId: id, status }, 'Gift status updated');
    return this.mapGift(result[0]);
  }

  async setGiftImage(
    id: string,
    imageUrl: string,
    s3Bucket: string,
    s3Key: string,
    tx?: TransactionContext
  ): Promise<Gift> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE gifts
      SET
        image_url = ${imageUrl},
        s3_bucket = ${s3Bucket},
        s3_key = ${s3Key},
        status = 'ready'
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Gift', id);
    }

    logger.debug({ giftId: id }, 'Gift image set');
    return this.mapGift(result[0]);
  }

  async markGiftGiven(id: string, tx?: TransactionContext): Promise<Gift> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE gifts
      SET
        status = 'given',
        given_at = NOW()
      WHERE id = ${id}
      RETURNING
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('Gift', id);
    }

    logger.info({ giftId: id }, 'Gift marked as given');
    return this.mapGift(result[0]);
  }

  async listUserGifts(
    userId: string,
    filters: GiftListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<GiftWithDetails>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const statusArray = Array.isArray(filters.status)
      ? filters.status
      : filters.status
        ? [filters.status]
        : null;

    const result = await db`
      SELECT
        g.id, g.user_id, g.companion_id, g.name, g.description, g.visual_prompt,
        g.emotional_meaning, g.image_url, g.s3_bucket, g.s3_key, g.token_cost,
        g.status, g.generation_params, g.generation_error, g.source_event_id,
        g.source_turn_id, g.given_at, g.created_at, g.updated_at,
        c.name as companion_name
      FROM gifts g
      JOIN companions c ON c.id = g.companion_id
      WHERE g.user_id = ${userId}
        ${statusArray ? db`AND g.status = ANY(${statusArray}::gift_status[])` : db``}
        ${filters.companionId ? db`AND g.companion_id = ${filters.companionId}` : db``}
      ORDER BY g.created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => ({
      ...this.mapGift(row),
      companionName: row.companion_name as string,
    }));

    return { data, hasMore };
  }

  async getGiftHistory(
    userId: string,
    companionId: string,
    filters: PaginationOptions = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<Gift>> {
    // Validate UUID formats before querying database
    validateUuid(userId, 'userId');
    validateUuid(companionId, 'companionId');

    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const result = await db`
      SELECT
        id, user_id, companion_id, name, description, visual_prompt,
        emotional_meaning, image_url, s3_bucket, s3_key, token_cost,
        status, generation_params, generation_error, source_event_id,
        source_turn_id, given_at, created_at, updated_at
      FROM gifts
      WHERE user_id = ${userId}
        AND companion_id = ${companionId}
        AND status = 'given'
      ORDER BY given_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapGift(row));

    return { data, hasMore };
  }

  async getSignificantGifts(
    userId: string,
    companionId: string,
    limit: number = 5,
    tx?: TransactionContext
  ): Promise<Gift[]> {
    // Validate UUID formats before querying database
    validateUuid(userId, 'userId');
    validateUuid(companionId, 'companionId');

    const db = this.getSql(tx);

    // Get gifts that have been recalled, ordered by recall count
    const result = await db`
      SELECT
        g.id, g.user_id, g.companion_id, g.name, g.description, g.visual_prompt,
        g.emotional_meaning, g.image_url, g.s3_bucket, g.s3_key, g.token_cost,
        g.status, g.generation_params, g.generation_error, g.source_event_id,
        g.source_turn_id, g.given_at, g.created_at, g.updated_at
      FROM gifts g
      LEFT JOIN gift_memories gm ON gm.gift_id = g.id
      WHERE g.user_id = ${userId}
        AND g.companion_id = ${companionId}
        AND g.status = 'given'
      GROUP BY g.id
      ORDER BY COALESCE(MAX(gm.times_recalled), 0) DESC, g.given_at DESC
      LIMIT ${limit}
    `;

    return result.map(row => this.mapGift(row));
  }

  // ===========================================================================
  // Gift Memories
  // ===========================================================================

  async createGiftMemory(data: GiftMemoryInsert, tx?: TransactionContext): Promise<GiftMemory> {
    // Validate UUID formats before inserting
    validateUuid(data.gift_id, 'gift_id');
    validateUuid(data.user_id, 'user_id');
    validateUuid(data.companion_id, 'companion_id');

    const db = this.getSql(tx);

    const result = await db`
      INSERT INTO gift_memories (
        gift_id, user_id, companion_id, memory_content, embedding,
        eligible_for_recall, recall_cooldown_until
      ) VALUES (
        ${data.gift_id},
        ${data.user_id},
        ${data.companion_id},
        ${data.memory_content},
        ${data.embedding ?? null},
        ${data.eligible_for_recall ?? true},
        ${data.recall_cooldown_until ?? null}
      )
      RETURNING
        id, gift_id, user_id, companion_id, memory_content, embedding,
        times_recalled, last_recalled_at, eligible_for_recall,
        recall_cooldown_until, created_at, updated_at
    `;

    const memory = this.mapGiftMemory(result[0]!);
    logger.debug({ memoryId: memory.id, giftId: data.gift_id }, 'Gift memory created');
    return memory;
  }

  async findGiftMemoryById(id: string, tx?: TransactionContext): Promise<GiftMemory | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, gift_id, user_id, companion_id, memory_content, embedding,
        times_recalled, last_recalled_at, eligible_for_recall,
        recall_cooldown_until, created_at, updated_at
      FROM gift_memories
      WHERE id = ${id}
    `;

    return result[0] ? this.mapGiftMemory(result[0]) : null;
  }

  async findGiftMemoryByGiftId(giftId: string, tx?: TransactionContext): Promise<GiftMemory | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, gift_id, user_id, companion_id, memory_content, embedding,
        times_recalled, last_recalled_at, eligible_for_recall,
        recall_cooldown_until, created_at, updated_at
      FROM gift_memories
      WHERE gift_id = ${giftId}
    `;

    return result[0] ? this.mapGiftMemory(result[0]) : null;
  }

  async updateEmbedding(
    id: string,
    embedding: number[],
    tx?: TransactionContext
  ): Promise<GiftMemory> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE gift_memories
      SET embedding = ${embedding}::vector
      WHERE id = ${id}
      RETURNING
        id, gift_id, user_id, companion_id, memory_content, embedding,
        times_recalled, last_recalled_at, eligible_for_recall,
        recall_cooldown_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('GiftMemory', id);
    }

    logger.debug({ memoryId: id }, 'Gift memory embedding updated');
    return this.mapGiftMemory(result[0]);
  }

  async getRecallableMemories(
    userId: string,
    companionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<GiftMemoryWithGift[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        gm.id, gm.gift_id, gm.user_id, gm.companion_id, gm.memory_content,
        gm.embedding, gm.times_recalled, gm.last_recalled_at,
        gm.eligible_for_recall, gm.recall_cooldown_until,
        gm.created_at, gm.updated_at,
        g.name as gift_name, g.image_url as gift_image_url
      FROM gift_memories gm
      JOIN gifts g ON g.id = gm.gift_id
      WHERE gm.user_id = ${userId}
        AND gm.companion_id = ${companionId}
        AND gm.eligible_for_recall = TRUE
        AND (gm.recall_cooldown_until IS NULL OR gm.recall_cooldown_until < NOW())
      ORDER BY gm.times_recalled ASC, gm.created_at DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      ...this.mapGiftMemory(row),
      giftName: row.gift_name as string,
      giftImageUrl: row.gift_image_url as string | null,
    }));
  }

  async searchByEmbedding(
    userId: string,
    companionId: string,
    embedding: number[],
    limit: number = 5,
    minSimilarity: number = 0.7,
    tx?: TransactionContext
  ): Promise<GiftMemorySearchResult[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        gm.id, gm.gift_id, gm.user_id, gm.companion_id, gm.memory_content,
        gm.embedding, gm.times_recalled, gm.last_recalled_at,
        gm.eligible_for_recall, gm.recall_cooldown_until,
        gm.created_at, gm.updated_at,
        g.name as gift_name, g.image_url as gift_image_url,
        1 - (gm.embedding <=> ${embedding}::vector) as similarity
      FROM gift_memories gm
      JOIN gifts g ON g.id = gm.gift_id
      WHERE gm.user_id = ${userId}
        AND gm.companion_id = ${companionId}
        AND gm.embedding IS NOT NULL
        AND gm.eligible_for_recall = TRUE
        AND (gm.recall_cooldown_until IS NULL OR gm.recall_cooldown_until < NOW())
        AND 1 - (gm.embedding <=> ${embedding}::vector) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    return result.map(row => ({
      ...this.mapGiftMemory(row),
      similarity: row.similarity as number,
      giftName: row.gift_name as string,
      giftImageUrl: row.gift_image_url as string | null,
    }));
  }

  async recordRecall(
    id: string,
    cooldownHours: number = 24,
    tx?: TransactionContext
  ): Promise<GiftMemory> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE gift_memories
      SET
        times_recalled = times_recalled + 1,
        last_recalled_at = NOW(),
        recall_cooldown_until = NOW() + (${cooldownHours} || ' hours')::interval
      WHERE id = ${id}
      RETURNING
        id, gift_id, user_id, companion_id, memory_content, embedding,
        times_recalled, last_recalled_at, eligible_for_recall,
        recall_cooldown_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('GiftMemory', id);
    }

    logger.debug({ memoryId: id, timesRecalled: result[0].times_recalled }, 'Gift memory recalled');
    return this.mapGiftMemory(result[0]);
  }

  async setRecallEligibility(
    id: string,
    eligible: boolean,
    tx?: TransactionContext
  ): Promise<GiftMemory> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE gift_memories
      SET eligible_for_recall = ${eligible}
      WHERE id = ${id}
      RETURNING
        id, gift_id, user_id, companion_id, memory_content, embedding,
        times_recalled, last_recalled_at, eligible_for_recall,
        recall_cooldown_until, created_at, updated_at
    `;

    if (!result[0]) {
      throw new NotFoundError('GiftMemory', id);
    }

    return this.mapGiftMemory(result[0]);
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapTokenBalance(row: Record<string, unknown>): TokenBalance {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      balance: row.balance as number,
      lifetime_purchased: row.lifetime_purchased as number,
      lifetime_bonus: row.lifetime_bonus as number,
      lifetime_spent: row.lifetime_spent as number,
      current_period_bonus: row.current_period_bonus as number,
      bonus_granted_at: row.bonus_granted_at as Date | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapTokenTransaction(row: Record<string, unknown>): TokenTransaction {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      transaction_type: row.transaction_type as TokenTransactionType,
      amount: row.amount as number,
      balance_after: row.balance_after as number,
      stripe_payment_intent_id: row.stripe_payment_intent_id as string | null,
      stripe_checkout_session_id: row.stripe_checkout_session_id as string | null,
      gift_id: row.gift_id as string | null,
      subscription_id: row.subscription_id as string | null,
      description: row.description as string | null,
      metadata: row.metadata as JSONObject,
      idempotency_key: row.idempotency_key as string | null,
      created_at: row.created_at as Date,
    };
  }

  private mapTokenBundle(row: Record<string, unknown>): TokenBundle {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      tokens: row.tokens as number,
      price_cents: row.price_cents as number,
      currency: row.currency as string,
      stripe_price_id: row.stripe_price_id as string | null,
      stripe_product_id: row.stripe_product_id as string | null,
      is_active: row.is_active as boolean,
      display_order: row.display_order as number,
      bonus_tokens: row.bonus_tokens as number,
      bonus_expires_at: row.bonus_expires_at as Date | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapGift(row: Record<string, unknown>): Gift {
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      companion_id: row.companion_id as string,
      name: row.name as string,
      description: row.description as string | null,
      visual_prompt: row.visual_prompt as string | null,
      emotional_meaning: row.emotional_meaning as string | null,
      image_url: row.image_url as string | null,
      s3_bucket: row.s3_bucket as string | null,
      s3_key: row.s3_key as string | null,
      token_cost: row.token_cost as number,
      status: row.status as GiftStatus,
      generation_params: row.generation_params as JSONObject | null,
      generation_error: row.generation_error as string | null,
      source_event_id: row.source_event_id as string | null,
      source_turn_id: row.source_turn_id as string | null,
      given_at: row.given_at as Date | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }

  private mapGiftMemory(row: Record<string, unknown>): GiftMemory {
    return {
      id: row.id as string,
      gift_id: row.gift_id as string,
      user_id: row.user_id as string,
      companion_id: row.companion_id as string,
      memory_content: row.memory_content as string,
      embedding: row.embedding as number[] | null,
      times_recalled: row.times_recalled as number,
      last_recalled_at: row.last_recalled_at as Date | null,
      eligible_for_recall: row.eligible_for_recall as boolean,
      recall_cooldown_until: row.recall_cooldown_until as Date | null,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}

// Singleton instance
let giftsRepository: GiftsRepository | null = null;

export function getGiftsRepository(): GiftsRepository {
  if (!giftsRepository) {
    giftsRepository = new GiftsRepository();
  }
  return giftsRepository;
}
