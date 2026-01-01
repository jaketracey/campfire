/**
 * Migration: Create Gifts Tables
 * Created: 2026-01-01
 *
 * Token-based gift system:
 * - token_balances: User token balance tracking
 * - token_transactions: Ledger of all token movements
 * - token_bundles: Purchasable token packages
 * - gifts: Generated gifts for companions
 * - gift_memories: Memories created from gift interactions
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Token transaction type enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE token_transaction_type AS ENUM (
        'purchase',
        'subscription_bonus',
        'gift_spent',
        'refund',
        'admin_grant'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Gift status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE gift_status AS ENUM (
        'generating',
        'ready',
        'given',
        'failed'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Token Balances Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS token_balances (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Current balance
      balance INTEGER NOT NULL DEFAULT 0,

      -- Lifetime stats
      lifetime_purchased INTEGER NOT NULL DEFAULT 0,
      lifetime_bonus INTEGER NOT NULL DEFAULT 0,
      lifetime_spent INTEGER NOT NULL DEFAULT 0,

      -- Current period bonus tracking (for subscription bonuses)
      current_period_bonus INTEGER NOT NULL DEFAULT 0,
      bonus_granted_at TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT token_balances_user_unique UNIQUE (user_id),
      CONSTRAINT token_balances_balance_non_negative CHECK (balance >= 0)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_balances_user_id
    ON token_balances (user_id)
  `;

  await sql`
    CREATE TRIGGER token_balances_updated_at
    BEFORE UPDATE ON token_balances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE token_balances IS 'User token balance tracking for gift purchases'
  `;

  // =========================================================================
  // Token Transactions Table (Ledger)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS token_transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Transaction details
      transaction_type token_transaction_type NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,

      -- Stripe references (for purchases/refunds)
      stripe_payment_intent_id VARCHAR(255),
      stripe_checkout_session_id VARCHAR(255),

      -- Related entities
      gift_id UUID,
      subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,

      -- Description and metadata
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',

      -- Idempotency
      idempotency_key VARCHAR(255),

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT token_transactions_idempotency_unique UNIQUE (idempotency_key)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_user_id
    ON token_transactions (user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_type
    ON token_transactions (transaction_type, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_stripe_payment
    ON token_transactions (stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_stripe_session
    ON token_transactions (stripe_checkout_session_id)
    WHERE stripe_checkout_session_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_gift
    ON token_transactions (gift_id)
    WHERE gift_id IS NOT NULL
  `;

  await sql`
    COMMENT ON TABLE token_transactions IS 'Immutable ledger of all token credits and debits'
  `;

  // =========================================================================
  // Token Bundles Table (Purchasable packages)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS token_bundles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Bundle details
      name VARCHAR(100) NOT NULL,
      description TEXT,
      tokens INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'usd',

      -- Stripe product/price IDs
      stripe_price_id VARCHAR(255),
      stripe_product_id VARCHAR(255),

      -- Status and ordering
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INTEGER NOT NULL DEFAULT 0,

      -- Bonus tokens
      bonus_tokens INTEGER NOT NULL DEFAULT 0,
      bonus_expires_at TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT token_bundles_stripe_price_unique UNIQUE (stripe_price_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_bundles_active
    ON token_bundles (is_active, display_order)
    WHERE is_active = TRUE
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_bundles_stripe_price
    ON token_bundles (stripe_price_id)
    WHERE stripe_price_id IS NOT NULL
  `;

  await sql`
    CREATE TRIGGER token_bundles_updated_at
    BEFORE UPDATE ON token_bundles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE token_bundles IS 'Purchasable token packages with Stripe integration'
  `;

  // =========================================================================
  // Gifts Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS gifts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- Gift details
      name VARCHAR(255) NOT NULL,
      description TEXT,
      visual_prompt TEXT,
      emotional_meaning TEXT,

      -- Generated image
      image_url TEXT,
      s3_bucket VARCHAR(255),
      s3_key VARCHAR(512),

      -- Token cost
      token_cost INTEGER NOT NULL,

      -- Status
      status gift_status NOT NULL DEFAULT 'generating',

      -- Generation metadata
      generation_params JSONB,
      generation_error TEXT,

      -- Source tracking
      source_event_id UUID,
      source_turn_id UUID,

      -- Gift given timestamp
      given_at TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gifts_user_id
    ON gifts (user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gifts_companion_id
    ON gifts (companion_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gifts_user_companion
    ON gifts (user_id, companion_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gifts_status
    ON gifts (status)
    WHERE status IN ('generating', 'ready')
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gifts_given
    ON gifts (user_id, companion_id, given_at DESC)
    WHERE status = 'given'
  `;

  await sql`
    CREATE TRIGGER gifts_updated_at
    BEFORE UPDATE ON gifts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE gifts IS 'User-created gifts for AI companions with generated images'
  `;

  // Add foreign key for token_transactions.gift_id now that gifts table exists
  await sql`
    ALTER TABLE token_transactions
    ADD CONSTRAINT token_transactions_gift_fk
    FOREIGN KEY (gift_id) REFERENCES gifts(id) ON DELETE SET NULL
  `;

  // =========================================================================
  // Gift Memories Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS gift_memories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      gift_id UUID NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- Memory content
      memory_content TEXT NOT NULL,

      -- Vector embedding for semantic search
      embedding vector(1536),

      -- Recall tracking
      times_recalled INTEGER NOT NULL DEFAULT 0,
      last_recalled_at TIMESTAMPTZ,

      -- Recall eligibility
      eligible_for_recall BOOLEAN NOT NULL DEFAULT TRUE,
      recall_cooldown_until TIMESTAMPTZ,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gift_memories_gift_id
    ON gift_memories (gift_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gift_memories_user_companion
    ON gift_memories (user_id, companion_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_gift_memories_recallable
    ON gift_memories (user_id, companion_id, eligible_for_recall)
    WHERE eligible_for_recall = TRUE
  `;

  // Vector similarity index for embedding search
  await sql`
    CREATE INDEX IF NOT EXISTS idx_gift_memories_embedding
    ON gift_memories USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `;

  await sql`
    CREATE TRIGGER gift_memories_updated_at
    BEFORE UPDATE ON gift_memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE gift_memories IS 'Memories created from gift interactions for recall during conversations'
  `;

  // =========================================================================
  // Helper Functions
  // =========================================================================

  // Credit tokens with idempotency
  await sql`
    CREATE OR REPLACE FUNCTION credit_tokens(
      p_user_id UUID,
      p_amount INTEGER,
      p_type token_transaction_type,
      p_stripe_payment_intent_id VARCHAR DEFAULT NULL,
      p_stripe_checkout_session_id VARCHAR DEFAULT NULL,
      p_subscription_id UUID DEFAULT NULL,
      p_description TEXT DEFAULT NULL,
      p_metadata JSONB DEFAULT '{}',
      p_idempotency_key VARCHAR DEFAULT NULL
    )
    RETURNS TABLE (
      transaction_id UUID,
      new_balance INTEGER,
      was_duplicate BOOLEAN
    ) AS $$
    DECLARE
      v_balance_id UUID;
      v_new_balance INTEGER;
      v_transaction_id UUID;
      v_existing_tx UUID;
    BEGIN
      -- Check for duplicate transaction
      IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_tx
        FROM token_transactions
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_tx IS NOT NULL THEN
          -- Return existing transaction info
          SELECT t.id, t.balance_after, TRUE
          INTO transaction_id, new_balance, was_duplicate
          FROM token_transactions t
          WHERE t.id = v_existing_tx;
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;

      -- Get or create balance record
      INSERT INTO token_balances (user_id, balance)
      VALUES (p_user_id, 0)
      ON CONFLICT (user_id) DO NOTHING;

      -- Update balance atomically
      UPDATE token_balances
      SET
        balance = balance + p_amount,
        lifetime_purchased = CASE
          WHEN p_type = 'purchase' THEN lifetime_purchased + p_amount
          ELSE lifetime_purchased
        END,
        lifetime_bonus = CASE
          WHEN p_type IN ('subscription_bonus', 'admin_grant') THEN lifetime_bonus + p_amount
          ELSE lifetime_bonus
        END,
        current_period_bonus = CASE
          WHEN p_type = 'subscription_bonus' THEN current_period_bonus + p_amount
          ELSE current_period_bonus
        END,
        bonus_granted_at = CASE
          WHEN p_type = 'subscription_bonus' THEN NOW()
          ELSE bonus_granted_at
        END
      WHERE user_id = p_user_id
      RETURNING id, balance INTO v_balance_id, v_new_balance;

      -- Record transaction
      INSERT INTO token_transactions (
        user_id, transaction_type, amount, balance_after,
        stripe_payment_intent_id, stripe_checkout_session_id,
        subscription_id, description, metadata, idempotency_key
      )
      VALUES (
        p_user_id, p_type, p_amount, v_new_balance,
        p_stripe_payment_intent_id, p_stripe_checkout_session_id,
        p_subscription_id, p_description, p_metadata, p_idempotency_key
      )
      RETURNING id INTO v_transaction_id;

      transaction_id := v_transaction_id;
      new_balance := v_new_balance;
      was_duplicate := FALSE;
      RETURN NEXT;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Deduct tokens atomically
  await sql`
    CREATE OR REPLACE FUNCTION deduct_tokens(
      p_user_id UUID,
      p_amount INTEGER,
      p_gift_id UUID,
      p_description TEXT DEFAULT NULL
    )
    RETURNS TABLE (
      success BOOLEAN,
      transaction_id UUID,
      new_balance INTEGER,
      error_message TEXT
    ) AS $$
    DECLARE
      v_current_balance INTEGER;
      v_new_balance INTEGER;
      v_transaction_id UUID;
    BEGIN
      -- Lock and get current balance
      SELECT balance INTO v_current_balance
      FROM token_balances
      WHERE user_id = p_user_id
      FOR UPDATE;

      -- Check if balance exists and is sufficient
      IF v_current_balance IS NULL THEN
        success := FALSE;
        error_message := 'No token balance found for user';
        RETURN NEXT;
        RETURN;
      END IF;

      IF v_current_balance < p_amount THEN
        success := FALSE;
        new_balance := v_current_balance;
        error_message := 'Insufficient token balance';
        RETURN NEXT;
        RETURN;
      END IF;

      -- Deduct tokens
      UPDATE token_balances
      SET
        balance = balance - p_amount,
        lifetime_spent = lifetime_spent + p_amount
      WHERE user_id = p_user_id
      RETURNING balance INTO v_new_balance;

      -- Record transaction
      INSERT INTO token_transactions (
        user_id, transaction_type, amount, balance_after,
        gift_id, description
      )
      VALUES (
        p_user_id, 'gift_spent', -p_amount, v_new_balance,
        p_gift_id, p_description
      )
      RETURNING id INTO v_transaction_id;

      success := TRUE;
      transaction_id := v_transaction_id;
      new_balance := v_new_balance;
      RETURN NEXT;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    COMMENT ON FUNCTION credit_tokens IS 'Atomically credit tokens to a user with idempotency support'
  `;

  await sql`
    COMMENT ON FUNCTION deduct_tokens IS 'Atomically deduct tokens from a user for gift purchases'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS deduct_tokens(UUID, INTEGER, UUID, TEXT)`;
  await sql`DROP FUNCTION IF EXISTS credit_tokens(UUID, INTEGER, token_transaction_type, VARCHAR, VARCHAR, UUID, TEXT, JSONB, VARCHAR)`;

  await sql`DROP TRIGGER IF EXISTS gift_memories_updated_at ON gift_memories`;
  await sql`DROP INDEX IF EXISTS idx_gift_memories_embedding`;
  await sql`DROP INDEX IF EXISTS idx_gift_memories_recallable`;
  await sql`DROP INDEX IF EXISTS idx_gift_memories_user_companion`;
  await sql`DROP INDEX IF EXISTS idx_gift_memories_gift_id`;
  await sql`DROP TABLE IF EXISTS gift_memories CASCADE`;

  await sql`ALTER TABLE token_transactions DROP CONSTRAINT IF EXISTS token_transactions_gift_fk`;

  await sql`DROP TRIGGER IF EXISTS gifts_updated_at ON gifts`;
  await sql`DROP INDEX IF EXISTS idx_gifts_given`;
  await sql`DROP INDEX IF EXISTS idx_gifts_status`;
  await sql`DROP INDEX IF EXISTS idx_gifts_user_companion`;
  await sql`DROP INDEX IF EXISTS idx_gifts_companion_id`;
  await sql`DROP INDEX IF EXISTS idx_gifts_user_id`;
  await sql`DROP TABLE IF EXISTS gifts CASCADE`;

  await sql`DROP TRIGGER IF EXISTS token_bundles_updated_at ON token_bundles`;
  await sql`DROP INDEX IF EXISTS idx_token_bundles_stripe_price`;
  await sql`DROP INDEX IF EXISTS idx_token_bundles_active`;
  await sql`DROP TABLE IF EXISTS token_bundles CASCADE`;

  await sql`DROP INDEX IF EXISTS idx_token_transactions_gift`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_stripe_session`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_stripe_payment`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_type`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_user_id`;
  await sql`DROP TABLE IF EXISTS token_transactions CASCADE`;

  await sql`DROP TRIGGER IF EXISTS token_balances_updated_at ON token_balances`;
  await sql`DROP INDEX IF EXISTS idx_token_balances_user_id`;
  await sql`DROP TABLE IF EXISTS token_balances CASCADE`;

  await sql`DROP TYPE IF EXISTS gift_status`;
  await sql`DROP TYPE IF EXISTS token_transaction_type`;
}
