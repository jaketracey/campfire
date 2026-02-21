/**
 * Migration: Revert Flowguard rename back to Stripe
 * Created: 2026-02-21
 *
 * Restores original Stripe column names, constraints, and indexes after the
 * temporary Flowguard rename migration.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Usage Records Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_usage_records_unsynced`;

  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN flowguard_usage_record_id TO stripe_usage_record_id
  `;

  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN synced_to_flowguard TO synced_to_stripe
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_unsynced
    ON usage_records (created_at)
    WHERE synced_to_stripe = FALSE
  `;

  // =========================================================================
  // Billing Events Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_billing_events_flowguard_type`;

  await sql`
    ALTER TABLE billing_events
    DROP CONSTRAINT IF EXISTS billing_events_flowguard_unique
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
    ALTER TABLE billing_events
    ADD COLUMN IF NOT EXISTS stripe_api_version VARCHAR(50)
  `;

  await sql`
    ALTER TABLE billing_events
    ADD CONSTRAINT billing_events_stripe_unique UNIQUE (stripe_event_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_type
    ON billing_events (stripe_event_type, created_at DESC)
  `;

  await sql`
    COMMENT ON TABLE billing_events IS 'Stripe webhook events log for idempotent processing'
  `;

  // =========================================================================
  // Token Bundles Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_token_bundles_flowguard_price`;

  await sql`
    ALTER TABLE token_bundles
    DROP CONSTRAINT IF EXISTS token_bundles_flowguard_price_unique
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
    CREATE INDEX IF NOT EXISTS idx_token_bundles_stripe_price
    ON token_bundles (stripe_price_id)
    WHERE stripe_price_id IS NOT NULL
  `;

  await sql`
    ALTER TABLE token_bundles
    ADD CONSTRAINT token_bundles_stripe_price_unique UNIQUE (stripe_price_id)
  `;

  await sql`
    COMMENT ON TABLE token_bundles IS 'Purchasable token packages with Stripe integration'
  `;

  // =========================================================================
  // Token Transactions Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_token_transactions_flowguard_session`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_flowguard_tx`;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN flowguard_session_id TO stripe_checkout_session_id
  `;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN flowguard_transaction_id TO stripe_payment_intent_id
  `;

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

  // =========================================================================
  // Subscriptions Table
  // =========================================================================

  await sql`DROP INDEX IF EXISTS idx_subscriptions_flowguard_customer`;

  await sql`
    ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_flowguard_unique
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
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
    ON subscriptions (stripe_customer_id)
  `;

  await sql`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_stripe_unique UNIQUE (stripe_subscription_id)
  `;

  await sql`
    COMMENT ON TABLE subscriptions IS 'User subscription state synchronized with Stripe'
  `;

  // =========================================================================
  // credit_tokens helper function
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
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Re-apply the Flowguard rename if this migration needs to be rolled back.
  // Reuse the original 042 migration to revert from Stripe back to Flowguard.
  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN stripe_usage_record_id TO flowguard_usage_record_id
  `;

  await sql`
    ALTER TABLE usage_records
    RENAME COLUMN synced_to_stripe TO synced_to_flowguard
  `;

  await sql`
    DROP INDEX IF EXISTS idx_usage_records_unsynced
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_usage_records_unsynced
    ON usage_records (created_at)
    WHERE synced_to_flowguard = FALSE
  `;

  await sql`
    ALTER TABLE billing_events
    DROP CONSTRAINT IF EXISTS billing_events_stripe_unique
  `;

  await sql`
    ALTER TABLE billing_events
    DROP COLUMN IF EXISTS stripe_api_version
  `;

  await sql`
    ALTER TABLE billing_events
    RENAME COLUMN stripe_event_type TO flowguard_event_type
  `;

  await sql`
    ALTER TABLE billing_events
    RENAME COLUMN stripe_event_id TO flowguard_event_id
  `;

  await sql`
    DROP INDEX IF EXISTS idx_billing_events_type
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_billing_events_flowguard_type
    ON billing_events (flowguard_event_type, created_at DESC)
  `;

  await sql`
    ALTER TABLE billing_events
    ADD CONSTRAINT billing_events_flowguard_unique UNIQUE (flowguard_event_id)
  `;

  await sql`
    COMMENT ON TABLE billing_events IS 'Flowguard postback events log for idempotent processing'
  `;

  await sql`
    ALTER TABLE token_bundles
    RENAME COLUMN stripe_product_id TO flowguard_product_id
  `;

  await sql`
    ALTER TABLE token_bundles
    RENAME COLUMN stripe_price_id TO flowguard_price_id
  `;

  await sql`
    DROP INDEX IF EXISTS idx_token_bundles_stripe_price
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_bundles_flowguard_price
    ON token_bundles (flowguard_price_id)
    WHERE flowguard_price_id IS NOT NULL
  `;

  await sql`
    ALTER TABLE token_bundles
    DROP CONSTRAINT IF EXISTS token_bundles_stripe_price_unique
  `;

  await sql`
    ALTER TABLE token_bundles
    ADD CONSTRAINT token_bundles_flowguard_price_unique UNIQUE (flowguard_price_id)
  `;

  await sql`
    COMMENT ON TABLE token_bundles IS 'Purchasable token packages with Flowguard integration'
  `;

  await sql`DROP INDEX IF EXISTS idx_token_transactions_stripe_session`;
  await sql`DROP INDEX IF EXISTS idx_token_transactions_stripe_payment`;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN stripe_checkout_session_id TO flowguard_session_id
  `;

  await sql`
    ALTER TABLE token_transactions
    RENAME COLUMN stripe_payment_intent_id TO flowguard_transaction_id
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_flowguard_session
    ON token_transactions (flowguard_session_id)
    WHERE flowguard_session_id IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_transactions_flowguard_tx
    ON token_transactions (flowguard_transaction_id)
    WHERE flowguard_transaction_id IS NOT NULL
  `;

  await sql`DROP INDEX IF EXISTS idx_subscriptions_stripe_customer`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_flowguard_customer
    ON subscriptions (flowguard_customer_id)
  `;

  await sql`
    ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_stripe_unique
  `;

  await sql`
    ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_flowguard_unique UNIQUE (flowguard_subscription_id)
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN stripe_price_id TO flowguard_price_id
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN stripe_subscription_id TO flowguard_subscription_id
  `;

  await sql`
    ALTER TABLE subscriptions
    RENAME COLUMN stripe_customer_id TO flowguard_customer_id
  `;

  await sql`
    COMMENT ON TABLE subscriptions IS 'User subscription state synchronized with Flowguard'
  `;

  await sql`
    DROP FUNCTION IF EXISTS credit_tokens(UUID, INTEGER, token_transaction_type, VARCHAR, VARCHAR, UUID, TEXT, JSONB, VARCHAR)
  `;

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
}
