/**
 * Migration: Create Creator Earnings Tables
 * Created: 2026-01-06
 *
 * Creator revenue attribution:
 * - token_spend_attributions: maps token ledger debits to a companion/creator/feature
 * - creator_earnings: computed earnings entries derived from token spends
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    DO $$ BEGIN
      CREATE TYPE token_spend_feature AS ENUM ('gift', 'voice_call', 'video', 'other');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS token_spend_attributions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      token_transaction_id UUID NOT NULL REFERENCES token_transactions(id) ON DELETE CASCADE,
      spender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      feature token_spend_feature NOT NULL DEFAULT 'other',
      tokens_spent INTEGER NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT token_spend_attributions_tx_unique UNIQUE (token_transaction_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_spend_attributions_creator_date
    ON token_spend_attributions(creator_user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_token_spend_attributions_companion_date
    ON token_spend_attributions(companion_id, created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_earnings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      token_transaction_id UUID NOT NULL REFERENCES token_transactions(id) ON DELETE CASCADE,
      creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      spender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature token_spend_feature NOT NULL DEFAULT 'other',
      tokens_spent INTEGER NOT NULL,
      gross_cents INTEGER NOT NULL,
      platform_fee_cents INTEGER NOT NULL,
      net_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT creator_earnings_tx_unique UNIQUE (token_transaction_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_date
    ON creator_earnings(creator_user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_creator_earnings_companion_date
    ON creator_earnings(companion_id, created_at DESC)
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_creator_earnings_companion_date`;
  await sql`DROP INDEX IF EXISTS idx_creator_earnings_creator_date`;
  await sql`DROP TABLE IF EXISTS creator_earnings CASCADE`;

  await sql`DROP INDEX IF EXISTS idx_token_spend_attributions_companion_date`;
  await sql`DROP INDEX IF EXISTS idx_token_spend_attributions_creator_date`;
  await sql`DROP TABLE IF EXISTS token_spend_attributions CASCADE`;

  await sql`DROP TYPE IF EXISTS token_spend_feature`;
}

