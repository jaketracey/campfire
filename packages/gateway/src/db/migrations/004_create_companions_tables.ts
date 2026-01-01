/**
 * Migration: Create Companion Tables
 * Created: 2026-01-01
 *
 * Companion configuration and avatar management:
 * - companions: Core companion spec (the "Companion Bible")
 * - companion_avatars: Generated avatar assets with provenance
 * - companion_versions: Version history for companion specs
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // Companion status enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE companion_status AS ENUM ('draft', 'active', 'archived');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // Avatar asset type enum
  await sql`
    DO $$ BEGIN
      CREATE TYPE avatar_asset_type AS ENUM ('identity_anchor', 'stateful', 'scene');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Companions Table (The "Companion Bible")
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS companions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      spec JSONB NOT NULL,
      spec_version INTEGER NOT NULL DEFAULT 1,
      status companion_status NOT NULL DEFAULT 'draft',
      active_avatar_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companions_user_id
    ON companions (user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companions_user_status
    ON companions (user_id, status)
    WHERE status = 'active'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companions_spec
    ON companions USING GIN (spec jsonb_path_ops)
  `;

  await sql`
    CREATE TRIGGER companions_updated_at
    BEFORE UPDATE ON companions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE companions IS 'AI companion configurations (the "Companion Bible")'
  `;

  await sql`
    COMMENT ON COLUMN companions.spec IS 'Full companion specification including identity, personality, voice, visual style, boundaries, and memory consent'
  `;

  // =========================================================================
  // Companion Versions Table (Spec History)
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS companion_versions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      spec JSONB NOT NULL,
      change_summary TEXT,
      source_event_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT companion_versions_unique UNIQUE (companion_id, version)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_versions_companion
    ON companion_versions (companion_id, version DESC)
  `;

  await sql`
    COMMENT ON TABLE companion_versions IS 'Version history for companion specifications'
  `;

  // Trigger to auto-archive spec versions on update
  await sql`
    CREATE OR REPLACE FUNCTION archive_companion_version()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.spec IS DISTINCT FROM NEW.spec THEN
        INSERT INTO companion_versions (companion_id, version, spec)
        VALUES (OLD.id, OLD.spec_version, OLD.spec);

        NEW.spec_version = OLD.spec_version + 1;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER companions_archive_version
    BEFORE UPDATE OF spec ON companions
    FOR EACH ROW
    EXECUTE FUNCTION archive_companion_version()
  `;

  // =========================================================================
  // Companion Avatars Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS companion_avatars (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      asset_url VARCHAR(2048) NOT NULL,
      asset_type avatar_asset_type NOT NULL DEFAULT 'stateful',
      s3_bucket VARCHAR(255),
      s3_key VARCHAR(1024),
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      is_identity_anchor BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB NOT NULL DEFAULT '{}',
      generation_params JSONB,
      source_event_id UUID,
      content_hash VARCHAR(64),
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_avatars_companion
    ON companion_avatars (companion_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_avatars_active
    ON companion_avatars (companion_id)
    WHERE is_active = TRUE
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_avatars_anchor
    ON companion_avatars (companion_id)
    WHERE is_identity_anchor = TRUE
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_avatars_type
    ON companion_avatars (companion_id, asset_type)
  `;

  await sql`
    COMMENT ON TABLE companion_avatars IS 'Generated avatar assets for companions with full provenance'
  `;

  await sql`
    COMMENT ON COLUMN companion_avatars.is_identity_anchor IS 'Reference images that define the companion visual identity (rarely change)'
  `;

  await sql`
    COMMENT ON COLUMN companion_avatars.generation_params IS 'Parameters used to generate the avatar (prompt, seed, model, etc.)'
  `;

  // Add foreign key for active_avatar_id now that companion_avatars exists
  await sql`
    ALTER TABLE companions
    ADD CONSTRAINT companions_active_avatar_fk
    FOREIGN KEY (active_avatar_id) REFERENCES companion_avatars(id) ON DELETE SET NULL
  `;

  // Ensure only one active avatar per companion
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companion_avatars_single_active
    ON companion_avatars (companion_id)
    WHERE is_active = TRUE
  `;

  // Trigger to ensure only one active avatar
  await sql`
    CREATE OR REPLACE FUNCTION ensure_single_active_avatar()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_active = TRUE THEN
        -- Deactivate other avatars for this companion
        UPDATE companion_avatars
        SET is_active = FALSE
        WHERE companion_id = NEW.companion_id
          AND id != NEW.id
          AND is_active = TRUE;

        -- Update companion's active_avatar_id
        UPDATE companions
        SET active_avatar_id = NEW.id
        WHERE id = NEW.companion_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE TRIGGER companion_avatars_single_active
    AFTER INSERT OR UPDATE OF is_active ON companion_avatars
    FOR EACH ROW
    WHEN (NEW.is_active = TRUE)
    EXECUTE FUNCTION ensure_single_active_avatar()
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS companion_avatars_single_active ON companion_avatars`;
  await sql`DROP FUNCTION IF EXISTS ensure_single_active_avatar()`;
  await sql`ALTER TABLE companions DROP CONSTRAINT IF EXISTS companions_active_avatar_fk`;
  await sql`DROP TABLE IF EXISTS companion_avatars CASCADE`;
  await sql`DROP TRIGGER IF EXISTS companions_archive_version ON companions`;
  await sql`DROP FUNCTION IF EXISTS archive_companion_version()`;
  await sql`DROP TABLE IF EXISTS companion_versions CASCADE`;
  await sql`DROP TRIGGER IF EXISTS companions_updated_at ON companions`;
  await sql`DROP TABLE IF EXISTS companions CASCADE`;
  await sql`DROP TYPE IF EXISTS avatar_asset_type`;
  await sql`DROP TYPE IF EXISTS companion_status`;
}
