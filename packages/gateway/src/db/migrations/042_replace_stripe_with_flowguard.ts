/**
 * Migration: Replace Stripe with Flowguard
 * Created: 2026-01-04
 *
 * Renames all Stripe-specific columns and constraints to Flowguard equivalents
 * for the transition from Stripe to Verotel/YoursAfe Flowguard payment processing.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Subscriptions Table
  // =========================================================================

  // Rename Stripe columns to Flowguard
  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN stripe_customer_id TO flowguard_customer_id
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN stripe_subscription_id TO flowguard_subscription_id
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN stripe_price_id TO flowguard_price_id
  `;

  // Drop old constraint and create new one
  await sql`
    ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_stripe_unique
  `;

  await sql`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_flowguard_unique UNIQUE (flowguard_subscription_id)
  `;

  // Drop old index and create new one
  await sql`DROP INDEX IF EXISTS idx_subscriptions_stripe_customer`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_flowguard_customer
    ON subscriptions (flowguard_customer_id)
  `;

  // Update table comment
  await sql`
    COMMENT ON TABLE subscriptions IS 'User subscription state synchronized with Flowguard'
  `;

  // =========================================================================
  // Token Transactions Table
  // =========================================================================

  // Rename Stripe columns to Flowguard
  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN stripe_payment_intent_id TO flowguard_transaction_id
  `;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN stripe_checkout_session_id TO flowguard_session_id
  `;

  // Drop old indexes
  await sql`DROP INDEX IF EXISTS idx_token_transactions_stripe_payment`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_stripe_session`;

  // Create new indexes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_flowguard_tx
    ON token_transactions (flowguard_transaction_id)
    WHERE flowguard_transaction_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_flowguard_session
    ON token_transactions (flowguard_session_id)
    WHERE flowguard_session_id IS NOT NULL
  `;

  // =========================================================================
  // Token Bundles Table
  // =========================================================================

  // Rename Stripe columns to Flowguard
  await sql`
    ALTER TABLE token_bundles
    RENAME COLUMN stripe_price_id TO flowguard_price_id
  `;

  await sql`
    ALTER TABLE token_bundles
    RENAME COLUMN stripe_product_id TO flowguard_product_id
  `;

  // Drop old constraint and create new one
  await sql`
    ALTER TABLE token_bundles
    DROP CONSTRAINT IF EXISTS token_bundles_stripe_price_unique
  `;

  await sql`
    ALTER TABLE token_bundles
    ADD CONSTRAINT token_bundles_flowguard_price_unique UNIQUE (flowguard_price_id)
  `;

  // Drop old index and create new one
  await sql`DROP INDEX IF EXISTS idx_token_bundles_stripe_price`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_bundles_flowguard_price
    ON token_bundles (flowguard_price_id)
    WHERE flowguard_price_id IS NOT NULL
  `;

  // Update table comment
  await sql`
    COMMENT ON TABLE token_bundles IS 'Purchasable token packages with Flowguard integration'
  `;

  // =========================================================================
  // Billing Events Table
  // =========================================================================

  // Rename Stripe columns to Flowguard
  await sql`
    ALTER TABLE billing_events
    RENAME COLUMN stripe_event_id TO flowguard_event_id
  `;

  await sql`
    ALTER TABLE billing_events
    RENAME COLUMN stripe_event_type TO flowguard_event_type
  `;

  // Drop stripe_api_version column (not needed for Flowguard)
  await sql`
    ALTER TABLE billing_events
    DROP COLUMN IF EXISTS stripe_api_version
  `;

  // Drop old constraint and create new one
  await sql`
    ALTER TABLE billing_events
    DROP CONSTRAINT IF EXISTS billing_events_stripe_unique
  `;

  await sql`
    ALTER TABLE billing_events
    ADD CONSTRAINT billing_events_flowguard_unique UNIQUE (flowguard_event_id)
  `;

  // Drop old index and create new one
  await sql`DROP INDEX IF EXISTS idx_billing_events_type`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_flowguard_type
    ON billing_events (flowguard_event_type, created_at DESC)
  `;

  // Update table comment
  await sql`
    COMMENT ON TABLE billing_events IS 'Flowguard postback events log for idempotent processing'
  `;

  // =========================================================================
  // Usage Records Table
  // =========================================================================

  // Rename stripe_usage_record_id to flowguard_usage_record_id
  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN stripe_usage_record_id TO flowguard_usage_record_id
  `;

  // Rename synced_to_stripe to synced_to_flowguard
  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN synced_to_stripe TO synced_to_flowguard
  `;

  // Drop old index and create new one
  await sql`DROP INDEX IF EXISTS idx_usage_records_unsynced`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_unsynced
    ON usage_records (created_at)
    WHERE synced_to_flowguard = FALSE
  `;

  // =========================================================================
  // Update credit_tokens Function
  // =========================================================================

  // Drop the old function
  await sql`
    DROP FUNCTION IF EXISTS credit_tokens(UUID, INTEGER, token_transaction_type, VARCHAR, VARCHAR, UUID, TEXT, JSONB, VARCHAR)
  `;

  // Create updated function with Flowguard parameter names
  await sql`
    CREATE OR REPLACE FUNCTION credit_tokens(
      p_user_id UUID,
      p_amount INTEGER,
      p_type token_transaction_type,
      p_flowguard_transaction_id VARCHAR DEFAULT NULL,
      p_flowguard_session_id VARCHAR DEFAULT NULL,
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
        flowguard_transaction_id, flowguard_session_id,
        subscription_id, description, metadata, idempotency_key
      )
      VALUES (
        p_user_id, p_type, p_amount, v_new_balance,
        p_flowguard_transaction_id, p_flowguard_session_id,
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

  await sql`
    COMMENT ON FUNCTION credit_tokens IS 'Atomically credit tokens to a user with idempotency support (Flowguard)'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Revert credit_tokens Function
  // =========================================================================

  await sql`
    DROP FUNCTION IF EXISTS credit_tokens(UUID, INTEGER, token_transaction_type, VARCHAR, VARCHAR, UUID, TEXT, JSONB, VARCHAR)
  `;

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
      IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_tx
        FROM token_transactions
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_tx IS NOT NULL THEN
          SELECT t.id, t.balance_after, TRUE
          INTO transaction_id, new_balance, was_duplicate
          FROM token_transactions t
          WHERE t.id = v_existing_tx;
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;

      INSERT INTO token_balances (user_id, balance)
      VALUES (p_user_id, 0)
      ON CONFLICT (user_id) DO NOTHING;

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

  // =========================================================================
  // Revert Usage Records Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_usage_records_unsynced`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_unsynced
    ON usage_records (created_at)
    WHERE synced_to_stripe = FALSE
  `;

  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN synced_to_flowguard TO synced_to_stripe
  `;

  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN flowguard_usage_record_id TO stripe_usage_record_id
  `;

  // =========================================================================
  // Revert Billing Events Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_billing_events_flowguard_type`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_type
    ON billing_events (stripe_event_type, created_at DESC)
  `;

  await sql`
    ALTER TABLE billing_events
    DROP CONSTRAINT IF EXISTS billing_events_flowguard_unique
  `;

  await sql`
    ALTER TABLE billing_events
    ADD CONSTRAINT billing_events_stripe_unique UNIQUE (stripe_event_id)
  `;

  await sql`
    ALTER TABLE billing_events
    ADD COLUMN IF NOT EXISTS stripe_api_version VARCHAR(50)
  `;

  await sql`
    ALTER TABLE billing_events
    RENAME COLUMN flowguard_event_type TO stripe_event_type
  `;

  await sql`
    ALTER TABLE billing_events
    RENAME COLUMN flowguard_event_id TO stripe_event_id
  `;

  await sql`
    COMMENT ON TABLE billing_events IS 'Stripe webhook events log for idempotent processing'
  `;

  // =========================================================================
  // Revert Token Bundles Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_token_bundles_flowguard_price`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_bundles_stripe_price
    ON token_bundles (stripe_price_id)
    WHERE stripe_price_id IS NOT NULL
  `;

  await sql`
    ALTER TABLE token_bundles
    DROP CONSTRAINT IF EXISTS token_bundles_flowguard_price_unique
  `;

  await sql`
    ALTER TABLE token_bundles
    ADD CONSTRAINT token_bundles_stripe_price_unique UNIQUE (stripe_price_id)
  `;

  await sql`
    ALTER TABLE token_bundles
    RENAME COLUMN flowguard_product_id TO stripe_product_id
  `;

  await sql`
    ALTER TABLE token_bundles
    RENAME COLUMN flowguard_price_id TO stripe_price_id
  `;

  await sql`
    COMMENT ON TABLE token_bundles IS 'Purchasable token packages with Stripe integration'
  `;

  // =========================================================================
  // Revert Token Transactions Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_token_transactions_flowguard_session`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_flowguard_tx`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_stripe_session
    ON token_transactions (stripe_checkout_session_id)
    WHERE stripe_checkout_session_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_stripe_payment
    ON token_transactions (stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL
  `;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN flowguard_session_id TO stripe_checkout_session_id
  `;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN flowguard_transaction_id TO stripe_payment_intent_id
  `;

  // =========================================================================
  // Revert Subscriptions Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_subscriptions_flowguard_customer`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
    ON subscriptions (stripe_customer_id)
  `;

  await sql`
    ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_flowguard_unique
  `;

  await sql`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_stripe_unique UNIQUE (stripe_subscription_id)
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN flowguard_price_id TO stripe_price_id
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN flowguard_subscription_id TO stripe_subscription_id
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN flowguard_customer_id TO stripe_customer_id
  `;

  await sql`
    COMMENT ON TABLE subscriptions IS 'User subscription state synchronized with Stripe'
  `;
}
