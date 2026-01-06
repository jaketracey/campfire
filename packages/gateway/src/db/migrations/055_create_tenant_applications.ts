/**
 * Migration: Create Tenant Applications
 * Created: 2026-01-06
 *
 * Stores inbound requests to become a white-label tenant.
 * Admins can review and approve/reject applications.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    DO $$ BEGIN
      CREATE TYPE tenant_application_status AS ENUM ('submitted', 'approved', 'rejected');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tenant_applications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      status tenant_application_status NOT NULL DEFAULT 'submitted',

      applicant_name VARCHAR(200) NOT NULL,
      applicant_email VARCHAR(320) NOT NULL,
      applicant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

      desired_tenant_name VARCHAR(120) NOT NULL,
      desired_slug VARCHAR(80) NOT NULL,
      desired_primary_domain VARCHAR(255),

      brand_config JSONB NOT NULL DEFAULT '{}',
      message TEXT,

      reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      decision_reason TEXT,

      approved_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
      approved_domain_id UUID REFERENCES tenant_domains(id) ON DELETE SET NULL,

      metadata JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenant_applications_status
    ON tenant_applications(status)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenant_applications_email
    ON tenant_applications(applicant_email)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenant_applications_slug
    ON tenant_applications(desired_slug)
  `;

  await sql`
    CREATE TRIGGER tenant_applications_updated_at
    BEFORE UPDATE ON tenant_applications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS tenant_applications_updated_at ON tenant_applications`;
  await sql`DROP INDEX IF EXISTS idx_tenant_applications_slug`;
  await sql`DROP INDEX IF EXISTS idx_tenant_applications_email`;
  await sql`DROP INDEX IF EXISTS idx_tenant_applications_status`;
  await sql`DROP TABLE IF EXISTS tenant_applications CASCADE`;
  await sql`DROP TYPE IF EXISTS tenant_application_status`;
}

