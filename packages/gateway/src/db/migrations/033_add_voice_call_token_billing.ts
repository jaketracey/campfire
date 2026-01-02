/**
 * Migration: Add Voice Call Token Billing
 * Created: 2026-01-02
 *
 * Adds 'voice_call' transaction type and function for deducting tokens
 * during voice calls (1 token per second).
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Add 'voice_call' to token_transaction_type enum
  await sql`
    ALTER TYPE token_transaction_type ADD VALUE IF NOT EXISTS 'voice_call'
  `;

  // Create function to deduct a single token for voice calls
  // This is optimized for frequent calls (every second during active call)
  await sql`
    CREATE OR REPLACE FUNCTION deduct_voice_call_token(
      p_user_id UUID,
      p_session_id UUID,
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
        new_balance := 0;
        error_message := 'No token balance found for user';
        RETURN NEXT;
        RETURN;
      END IF;

      IF v_current_balance < 1 THEN
        success := FALSE;
        new_balance := v_current_balance;
        error_message := 'Insufficient token balance';
        RETURN NEXT;
        RETURN;
      END IF;

      -- Deduct 1 token
      UPDATE token_balances
      SET
        balance = balance - 1,
        lifetime_spent = lifetime_spent + 1
      WHERE user_id = p_user_id
      RETURNING balance INTO v_new_balance;

      -- Record transaction
      INSERT INTO token_transactions (
        user_id, transaction_type, amount, balance_after,
        description, metadata
      )
      VALUES (
        p_user_id, 'voice_call', -1, v_new_balance,
        p_description,
        jsonb_build_object('session_id', p_session_id)
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
    COMMENT ON FUNCTION deduct_voice_call_token IS 'Atomically deduct 1 token for voice call billing (called every second during active call)'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS deduct_voice_call_token(UUID, UUID, TEXT)`;

  // Note: Cannot remove enum value in PostgreSQL without recreating the type
  // The 'voice_call' value will remain but be unused after rollback
}
