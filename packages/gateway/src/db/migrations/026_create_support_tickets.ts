/**
 * Migration: Create Support Tickets Table
 * Created: 2026-01-02
 *
 * Support ticket system for user issues and feature requests.
 * - support_ticket_category: Type of ticket (bug, feature_request, account, billing, other)
 * - support_ticket_status: Ticket lifecycle (open, in_progress, resolved, closed)
 * - support_tickets: Main ticket storage
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Support ticket category enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE support_ticket_category AS ENUM ('bug', 'feature_request', 'account', 'billing', 'other');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Support ticket status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE support_ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Support Tickets Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Ticket content
      category support_ticket_category NOT NULL,
      subject VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,

      -- Status tracking
      status support_ticket_status NOT NULL DEFAULT 'open',

      -- Resolution tracking
      resolved_at TIMESTAMPTZ,
      resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Index on status for filtering open/in_progress tickets
  await sql`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status
    ON support_tickets (status)
    WHERE status IN ('open', 'in_progress')
  `;

  // Index on user_id for user's ticket list
  await sql`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user
    ON support_tickets (user_id, created_at DESC)
  `;

  // Index for admin listing (newest first)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_created
    ON support_tickets (created_at DESC)
  `;

  // Updated at trigger
  await sql`
    CREATE TRIGGER support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE support_tickets IS 'User support tickets for bugs, feature requests, and account issues'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS support_tickets_updated_at ON support_tickets`;
  await sql`DROP INDEX IF EXISTS idx_support_tickets_created`;
  await sql`DROP INDEX IF EXISTS idx_support_tickets_user`;
  await sql`DROP INDEX IF EXISTS idx_support_tickets_status`;
  await sql`DROP TABLE IF EXISTS support_tickets CASCADE`;
  await sql`DROP TYPE IF EXISTS support_ticket_status`;
  await sql`DROP TYPE IF EXISTS support_ticket_category`;
}
