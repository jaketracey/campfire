/**
 * Migration: Create Provider Settings Tables
 * Created: 2026-01-02
 *
 * Tables for managing AI provider configurations and model routing:
 * - provider_configs: Provider-level settings with encrypted API keys
 * - model_configs: Available models per provider with pricing
 * - routing_rules: Platform-wide routing rules per use case
 * - companion_routing_overrides: Per-companion routing customization
 */

import type postgres from 'postgres';

export async function up(sql: postgres.Sql): Promise<void> {
  // =========================================================================
  // Enable pgcrypto extension for API key encryption
  // =========================================================================
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  // =========================================================================
  // Use Case Type Enum
  // =========================================================================
  await sql`
    DO $$ BEGIN
      CREATE TYPE use_case_type AS ENUM (
        'chat_simple',
        'chat_complex',
        'memory_extraction',
        'summarization',
        'context_compression',
        'safety_check',
        'content_moderation'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `;

  // =========================================================================
  // Provider Configs Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS provider_configs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider VARCHAR(50) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      api_key_encrypted BYTEA,
      api_base_url TEXT,
      rate_limit_rpm INTEGER,
      rate_limit_tpm INTEGER,
      max_concurrent_requests INTEGER NOT NULL DEFAULT 10,
      priority INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT provider_configs_priority_check CHECK (priority >= 0),
      CONSTRAINT provider_configs_rate_limit_rpm_check CHECK (rate_limit_rpm IS NULL OR rate_limit_rpm > 0),
      CONSTRAINT provider_configs_rate_limit_tpm_check CHECK (rate_limit_tpm IS NULL OR rate_limit_tpm > 0),
      CONSTRAINT provider_configs_max_concurrent_check CHECK (max_concurrent_requests > 0)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_provider_configs_enabled
    ON provider_configs (is_enabled, priority)
  `;

  await sql`
    CREATE TRIGGER provider_configs_updated_at
    BEFORE UPDATE ON provider_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE provider_configs IS 'AI provider configurations with encrypted API keys'
  `;

  await sql`
    COMMENT ON COLUMN provider_configs.api_key_encrypted IS 'API key encrypted with pgp_sym_encrypt'
  `;

  // =========================================================================
  // Model Configs Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS model_configs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider_config_id UUID NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
      model_id VARCHAR(255) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      context_window INTEGER,
      max_output_tokens INTEGER,
      input_cost_per_million NUMERIC(10, 4),
      output_cost_per_million NUMERIC(10, 4),
      capabilities JSONB NOT NULL DEFAULT '[]',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT model_configs_unique_per_provider UNIQUE(provider_config_id, model_id),
      CONSTRAINT model_configs_context_window_check CHECK (context_window IS NULL OR context_window > 0),
      CONSTRAINT model_configs_max_output_check CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
      CONSTRAINT model_configs_input_cost_check CHECK (input_cost_per_million IS NULL OR input_cost_per_million >= 0),
      CONSTRAINT model_configs_output_cost_check CHECK (output_cost_per_million IS NULL OR output_cost_per_million >= 0)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_model_configs_provider
    ON model_configs (provider_config_id, is_enabled)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_model_configs_model_id
    ON model_configs (model_id)
  `;

  await sql`
    CREATE TRIGGER model_configs_updated_at
    BEFORE UPDATE ON model_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE model_configs IS 'Available models per provider with pricing and capabilities'
  `;

  // =========================================================================
  // Routing Rules Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      use_case use_case_type NOT NULL,
      tier INTEGER NOT NULL DEFAULT 1,
      model_config_id UUID NOT NULL REFERENCES model_configs(id) ON DELETE CASCADE,
      weight INTEGER NOT NULL DEFAULT 100,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      max_retries INTEGER NOT NULL DEFAULT 2,
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT routing_rules_unique_model_per_tier UNIQUE(use_case, tier, model_config_id),
      CONSTRAINT routing_rules_tier_check CHECK (tier >= 1 AND tier <= 3),
      CONSTRAINT routing_rules_weight_check CHECK (weight >= 0 AND weight <= 100),
      CONSTRAINT routing_rules_max_retries_check CHECK (max_retries >= 0 AND max_retries <= 5),
      CONSTRAINT routing_rules_timeout_check CHECK (timeout_ms >= 1000 AND timeout_ms <= 300000)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_routing_rules_use_case
    ON routing_rules (use_case, tier, is_enabled)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_routing_rules_model
    ON routing_rules (model_config_id)
  `;

  await sql`
    CREATE TRIGGER routing_rules_updated_at
    BEFORE UPDATE ON routing_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE routing_rules IS 'Platform-wide routing rules per use case with fallback tiers'
  `;

  await sql`
    COMMENT ON COLUMN routing_rules.tier IS 'Fallback tier: 1=primary, 2=secondary, 3=tertiary'
  `;

  await sql`
    COMMENT ON COLUMN routing_rules.weight IS 'Load balancing weight within tier (0-100)'
  `;

  // =========================================================================
  // Companion Routing Overrides Table
  // =========================================================================
  await sql`
    CREATE TABLE IF NOT EXISTS companion_routing_overrides (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
      use_case use_case_type NOT NULL,
      tier INTEGER NOT NULL DEFAULT 1,
      model_config_id UUID NOT NULL REFERENCES model_configs(id) ON DELETE CASCADE,
      weight INTEGER NOT NULL DEFAULT 100,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      max_retries INTEGER,
      timeout_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT companion_routing_unique_model UNIQUE(companion_id, use_case, tier, model_config_id),
      CONSTRAINT companion_routing_tier_check CHECK (tier >= 1 AND tier <= 3),
      CONSTRAINT companion_routing_weight_check CHECK (weight >= 0 AND weight <= 100),
      CONSTRAINT companion_routing_max_retries_check CHECK (max_retries IS NULL OR (max_retries >= 0 AND max_retries <= 5)),
      CONSTRAINT companion_routing_timeout_check CHECK (timeout_ms IS NULL OR (timeout_ms >= 1000 AND timeout_ms <= 300000))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_routing_companion
    ON companion_routing_overrides (companion_id, use_case)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_routing_model
    ON companion_routing_overrides (model_config_id)
  `;

  await sql`
    CREATE TRIGGER companion_routing_overrides_updated_at
    BEFORE UPDATE ON companion_routing_overrides
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at()
  `;

  await sql`
    COMMENT ON TABLE companion_routing_overrides IS 'Per-companion routing customization (overrides platform defaults)'
  `;

  await sql`
    COMMENT ON COLUMN companion_routing_overrides.max_retries IS 'NULL means inherit from platform default'
  `;

  await sql`
    COMMENT ON COLUMN companion_routing_overrides.timeout_ms IS 'NULL means inherit from platform default'
  `;

  // =========================================================================
  // Initialize default provider configs (matching orchestration_provider_health)
  // =========================================================================
  await sql`
    INSERT INTO provider_configs (provider, display_name, is_enabled, priority)
    VALUES
      ('anthropic', 'Anthropic', TRUE, 1),
      ('openai', 'OpenAI', TRUE, 2),
      ('ollama', 'Ollama (Local)', TRUE, 10),
      ('together', 'Together AI', TRUE, 3),
      ('groq', 'Groq', TRUE, 4)
    ON CONFLICT (provider) DO NOTHING
  `;

  // =========================================================================
  // Function: Get effective routing for a companion and use case
  // =========================================================================
  await sql`
    CREATE OR REPLACE FUNCTION get_effective_routing(
      p_companion_id UUID,
      p_use_case use_case_type
    )
    RETURNS TABLE (
      tier INTEGER,
      model_config_id UUID,
      model_id VARCHAR(255),
      provider VARCHAR(50),
      weight INTEGER,
      max_retries INTEGER,
      timeout_ms INTEGER,
      is_override BOOLEAN
    )
    LANGUAGE plpgsql
    STABLE
    AS $$
    BEGIN
      -- If companion has overrides, use those; otherwise use platform defaults
      IF EXISTS (
        SELECT 1 FROM companion_routing_overrides cro
        WHERE cro.companion_id = p_companion_id
          AND cro.use_case = p_use_case
          AND cro.is_enabled = TRUE
      ) THEN
        -- Return companion overrides
        RETURN QUERY
        SELECT
          cro.tier,
          cro.model_config_id,
          mc.model_id,
          pc.provider,
          cro.weight,
          COALESCE(cro.max_retries, 2) AS max_retries,
          COALESCE(cro.timeout_ms, 30000) AS timeout_ms,
          TRUE AS is_override
        FROM companion_routing_overrides cro
        JOIN model_configs mc ON mc.id = cro.model_config_id
        JOIN provider_configs pc ON pc.id = mc.provider_config_id
        WHERE cro.companion_id = p_companion_id
          AND cro.use_case = p_use_case
          AND cro.is_enabled = TRUE
          AND mc.is_enabled = TRUE
          AND pc.is_enabled = TRUE
        ORDER BY cro.tier ASC, cro.weight DESC;
      ELSE
        -- Return platform defaults
        RETURN QUERY
        SELECT
          rr.tier,
          rr.model_config_id,
          mc.model_id,
          pc.provider,
          rr.weight,
          rr.max_retries,
          rr.timeout_ms,
          FALSE AS is_override
        FROM routing_rules rr
        JOIN model_configs mc ON mc.id = rr.model_config_id
        JOIN provider_configs pc ON pc.id = mc.provider_config_id
        WHERE rr.use_case = p_use_case
          AND rr.is_enabled = TRUE
          AND mc.is_enabled = TRUE
          AND pc.is_enabled = TRUE
        ORDER BY rr.tier ASC, rr.weight DESC;
      END IF;
    END;
    $$
  `;

  await sql`
    COMMENT ON FUNCTION get_effective_routing IS 'Resolves final routing config for a companion, using overrides if present'
  `;
}

export async function down(sql: postgres.Sql): Promise<void> {
  // Drop function
  await sql`DROP FUNCTION IF EXISTS get_effective_routing(UUID, use_case_type)`;

  // Drop companion routing overrides table
  await sql`DROP TRIGGER IF EXISTS companion_routing_overrides_updated_at ON companion_routing_overrides`;
  await sql`DROP INDEX IF EXISTS idx_companion_routing_model`;
  await sql`DROP INDEX IF EXISTS idx_companion_routing_companion`;
  await sql`DROP TABLE IF EXISTS companion_routing_overrides CASCADE`;

  // Drop routing rules table
  await sql`DROP TRIGGER IF EXISTS routing_rules_updated_at ON routing_rules`;
  await sql`DROP INDEX IF EXISTS idx_routing_rules_model`;
  await sql`DROP INDEX IF EXISTS idx_routing_rules_use_case`;
  await sql`DROP TABLE IF EXISTS routing_rules CASCADE`;

  // Drop model configs table
  await sql`DROP TRIGGER IF EXISTS model_configs_updated_at ON model_configs`;
  await sql`DROP INDEX IF EXISTS idx_model_configs_model_id`;
  await sql`DROP INDEX IF EXISTS idx_model_configs_provider`;
  await sql`DROP TABLE IF EXISTS model_configs CASCADE`;

  // Drop provider configs table
  await sql`DROP TRIGGER IF EXISTS provider_configs_updated_at ON provider_configs`;
  await sql`DROP INDEX IF EXISTS idx_provider_configs_enabled`;
  await sql`DROP TABLE IF EXISTS provider_configs CASCADE`;

  // Drop enum type
  await sql`DROP TYPE IF EXISTS use_case_type`;
}
