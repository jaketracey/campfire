/**
 * Migration: Add User Role Column
 * Created: 2026-01-01
 *
 * Adds role column to users table for admin/user distinction.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // User role enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('user', 'admin');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Add role column with default 'user'
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user'
  `;

  // Partial index for finding admin users quickly
  await sql`
    CREATE INDEX IF NOT EXISTS idx_users_role_admin
    ON users (role)
    WHERE role = 'admin'
  `;

  await sql`
    COMMENT ON COLUMN users.role IS 'User role: user (default) or admin'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_users_role_admin`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS role`;
  await sql`DROP TYPE IF EXISTS user_role`;
}
