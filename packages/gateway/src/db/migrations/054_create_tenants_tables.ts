/**
 * Migration: Create Tenants Tables
 * Created: 2026-01-06
 *
 * Multi-tenant white-label support:
 * - tenants: tenant/brand configuration (typically owned by a creator)
 * - tenant_domains: host/domain routing to tenants
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  await sql`
    DO $$ BEGIN
      CREATE TYPE tenant_status AS ENUM ('active', 'suspended');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug VARCHAR(80) NOT NULL,
      name VARCHAR(120) NOT NULL,
      status tenant_status NOT NULL DEFAULT 'active',
      brand_config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT tenants_slug_unique UNIQUE (slug),
      CONSTRAINT tenants_owner_unique UNIQUE (owner_user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenants_status
    ON tenants(status)
    WHERE status = 'active'
  `;

  await sql`
    CREATE TRIGGER tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tenant_domains (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      domain VARCHAR(255) NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token VARCHAR(64),
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT tenant_domains_domain_unique UNIQUE (domain)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant
    ON tenant_domains(tenant_id)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_domains_primary
    ON tenant_domains(tenant_id)
    WHERE is_primary = TRUE
  `;

  await sql`
    CREATE TRIGGER tenant_domains_updated_at
    BEFORE UPDATE ON tenant_domains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS tenant_domains_updated_at ON tenant_domains`;
  await sql`DROP INDEX IF EXISTS idx_tenant_domains_primary`;
  await sql`DROP INDEX IF EXISTS idx_tenant_domains_tenant`;
  await sql`DROP TABLE IF EXISTS tenant_domains CASCADE`;

  await sql`DROP TRIGGER IF EXISTS tenants_updated_at ON tenants`;
  await sql`DROP INDEX IF EXISTS idx_tenants_status`;
  await sql`DROP TABLE IF EXISTS tenants CASCADE`;

  await sql`DROP TYPE IF EXISTS tenant_status`;
}
