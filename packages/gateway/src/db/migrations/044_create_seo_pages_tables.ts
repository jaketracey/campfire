/**
 * Migration: Create SEO Pages Tables
 * Created: 2026-01-04
 *
 * SEO page system tables:
 * - seo_pages: AI-generated companion profile pages for search engine traffic
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // SEO page status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE seo_page_status AS ENUM ('draft', 'generating', 'published', 'archived');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // SEO Pages Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS seo_pages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      -- Companion reference (one SEO page per companion)
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,

      -- URL identity
      slug VARCHAR(100) NOT NULL,

      -- SEO metadata
      title VARCHAR(200) NOT NULL,
      meta_description VARCHAR(320),
      og_title VARCHAR(200),
      og_description VARCHAR(320),
      og_image_url VARCHAR(2048),

      -- Content (stored inline for fast SSR reads)
      content_html TEXT NOT NULL DEFAULT '',
      content_json JSONB NOT NULL DEFAULT '{}',

      -- Status & versioning
      status seo_page_status NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      published_at TIMESTAMPTZ,

      -- Generation metadata
      generated_by_model VARCHAR(100),
      generation_error TEXT,

      -- Audit
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Constraints
      CONSTRAINT seo_pages_slug_unique UNIQUE (slug),
      CONSTRAINT seo_pages_companion_unique UNIQUE (companion_id)
    )
  `;

  // Index for fast slug lookups on published pages (SSR)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_seo_pages_slug_published
    ON seo_pages (slug)
    WHERE status = 'published'
  `;

  // Index for sitemap generation (published pages by date)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_seo_pages_published
    ON seo_pages (published_at DESC)
    WHERE status = 'published'
  `;

  // Index for admin listing by status
  await sql`
    CREATE INDEX IF NOT EXISTS idx_seo_pages_status
    ON seo_pages (status, updated_at DESC)
  `;

  // Auto-update updated_at trigger
  await sql`
    CREATE TRIGGER seo_pages_updated_at
    BEFORE UPDATE ON seo_pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE seo_pages IS 'AI-generated companion profile pages for SEO'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS seo_pages_updated_at ON seo_pages`;
  await sql`DROP TABLE IF EXISTS seo_pages CASCADE`;
  await sql`DROP TYPE IF EXISTS seo_page_status`;
}
