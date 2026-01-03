/**
 * Migration: Create Gift Templates Table
 *
 * Creates a global gift template library where all generated gifts are saved
 * for reuse. Users can browse popular/trending gifts or generate custom ones.
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Create gift_templates table
  await sql`
    CREATE TABLE IF NOT EXISTS gift_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Content (derived from generated gifts)
      name VARCHAR(255) NOT NULL,
      description TEXT,
      visual_prompt TEXT,
      emotional_meaning TEXT,

      -- Image storage
      image_url TEXT NOT NULL,
      s3_bucket VARCHAR(255),
      s3_key VARCHAR(512),

      -- Categorization and pricing
      category VARCHAR(50) NOT NULL DEFAULT 'other',
      token_cost INTEGER NOT NULL,
      tier VARCHAR(10) NOT NULL DEFAULT 'medium',

      -- Status: active, hidden, archived
      status VARCHAR(20) NOT NULL DEFAULT 'active',

      -- Popularity tracking
      total_sends INTEGER NOT NULL DEFAULT 0,
      sends_last_7_days INTEGER NOT NULL DEFAULT 0,
      sends_last_30_days INTEGER NOT NULL DEFAULT 0,
      last_sent_at TIMESTAMPTZ,

      -- Origin tracking
      source_gift_id UUID REFERENCES gifts(id) ON DELETE SET NULL,

      -- Content hash for deduplication
      content_hash VARCHAR(64) NOT NULL,

      -- Timestamps
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT gift_templates_content_hash_unique UNIQUE (content_hash)
    )
  `;

  // Add template_id column to gifts table
  await sql`
    ALTER TABLE gifts
    ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES gift_templates(id) ON DELETE SET NULL
  `;

  // Create indexes for catalog queries
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_status ON gift_templates(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_category ON gift_templates(category, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_tier ON gift_templates(tier, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_popularity ON gift_templates(total_sends DESC) WHERE status = 'active'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_trending ON gift_templates(sends_last_7_days DESC) WHERE status = 'active'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_created_at ON gift_templates(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gift_templates_content_hash ON gift_templates(content_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gifts_template_id ON gifts(template_id) WHERE template_id IS NOT NULL`;

  // Create updated_at trigger
  await sql`
    CREATE OR REPLACE FUNCTION update_gift_templates_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DROP TRIGGER IF EXISTS trigger_gift_templates_updated_at ON gift_templates
  `;

  await sql`
    CREATE TRIGGER trigger_gift_templates_updated_at
      BEFORE UPDATE ON gift_templates
      FOR EACH ROW
      EXECUTE FUNCTION update_gift_templates_updated_at()
  `;

  // Function to increment template popularity when a gift is sent
  await sql`
    CREATE OR REPLACE FUNCTION increment_gift_template_popularity(p_template_id UUID)
    RETURNS void AS $$
    BEGIN
      UPDATE gift_templates
      SET
        total_sends = total_sends + 1,
        sends_last_7_days = sends_last_7_days + 1,
        sends_last_30_days = sends_last_30_days + 1,
        last_sent_at = NOW()
      WHERE id = p_template_id;
    END;
    $$ LANGUAGE plpgsql
  `;

  // Add comment
  await sql`
    COMMENT ON TABLE gift_templates IS 'Global gift template library - all generated gifts are saved here for reuse'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`ALTER TABLE gifts DROP COLUMN IF EXISTS template_id`;
  await sql`DROP TRIGGER IF EXISTS trigger_gift_templates_updated_at ON gift_templates`;
  await sql`DROP FUNCTION IF EXISTS update_gift_templates_updated_at()`;
  await sql`DROP FUNCTION IF EXISTS increment_gift_template_popularity(UUID)`;
  await sql`DROP TABLE IF EXISTS gift_templates`;
}
