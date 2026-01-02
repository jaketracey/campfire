/**
 * Provider Settings Repository
 * Data access for AI provider configurations, model settings, and routing rules
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type postgres from 'postgres';
import type {
  UUID,
  Timestamp,
  JSONObject,
  UseCaseType,
  ProviderConfig,
  ProviderConfigInsert,
  ProviderConfigUpdate,
  ProviderConfigWithHealth,
  ProviderConfigWithModels,
  ModelConfig,
  ModelConfigInsert,
  ModelConfigUpdate,
  ModelConfigWithProvider,
  ModelCapability,
  RoutingRule,
  RoutingRuleInsert,
  RoutingRuleUpdate,
  RoutingRuleWithModel,
  CompanionRoutingOverride,
  CompanionRoutingOverrideInsert,
  CompanionRoutingOverrideUpdate,
  EffectiveRoutingEntry,
  EffectiveRoutingConfig,
} from '../db/types.js';
import type { TransactionContext, PaginatedResult } from './types.js';
import { NotFoundError, DuplicateError, wrapDatabaseError, isUniqueViolation } from './errors.js';

// ============================================================================
// Filter Types
// ============================================================================

export interface ProviderListFilters {
  is_enabled?: boolean;
  limit?: number;
  offset?: number;
}

export interface ModelListFilters {
  provider_config_id?: UUID;
  is_enabled?: boolean;
  limit?: number;
  offset?: number;
}

export interface RoutingRuleListFilters {
  use_case?: UseCaseType;
  tier?: number;
  is_enabled?: boolean;
  limit?: number;
  offset?: number;
}

export interface CompanionOverrideListFilters {
  companion_id: UUID;
  use_case?: UseCaseType;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Repository
// ============================================================================

export class ProviderSettingsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // ===========================================================================
  // Provider Configs
  // ===========================================================================

  /**
   * Create a new provider configuration
   */
  async createProvider(
    input: ProviderConfigInsert,
    encryptionKey: string,
    tx?: TransactionContext
  ): Promise<ProviderConfig> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO provider_configs (
          provider, display_name, is_enabled, api_key_encrypted,
          api_base_url, rate_limit_rpm, rate_limit_tpm,
          max_concurrent_requests, priority, metadata
        )
        VALUES (
          ${input.provider},
          ${input.display_name},
          ${input.is_enabled ?? true},
          ${input.api_key ? db`pgp_sym_encrypt(${input.api_key}, ${encryptionKey})` : null},
          ${input.api_base_url ?? null},
          ${input.rate_limit_rpm ?? null},
          ${input.rate_limit_tpm ?? null},
          ${input.max_concurrent_requests ?? 10},
          ${input.priority ?? 0},
          ${input.metadata ? db.json(input.metadata as postgres.JSONValue) : db`'{}'::jsonb`}
        )
        RETURNING *
      `;

      const provider = this.mapProviderConfig(result[0]!);
      logger.info({ providerId: provider.id, provider: provider.provider }, 'Provider config created');
      return provider;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('ProviderConfig', 'provider', input.provider);
      }
      throw wrapDatabaseError(error, 'providerSettings.createProvider');
    }
  }

  /**
   * Get a provider by ID
   */
  async getProviderById(id: UUID, tx?: TransactionContext): Promise<ProviderConfig | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM provider_configs WHERE id = ${id}
    `;

    return result[0] ? this.mapProviderConfig(result[0]) : null;
  }

  /**
   * Get a provider by provider name
   */
  async getProviderByName(provider: string, tx?: TransactionContext): Promise<ProviderConfig | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM provider_configs WHERE provider = ${provider}
    `;

    return result[0] ? this.mapProviderConfig(result[0]) : null;
  }

  /**
   * Get provider with health status
   */
  async getProviderWithHealth(id: UUID, tx?: TransactionContext): Promise<ProviderConfigWithHealth | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        pc.*,
        pc.api_key_encrypted IS NOT NULL AS has_api_key,
        (SELECT COUNT(*)::int FROM model_configs mc WHERE mc.provider_config_id = pc.id) AS model_count,
        oph.is_available AS health_is_available,
        oph.last_check_at AS health_last_check_at,
        oph.avg_latency_ms AS health_avg_latency_ms,
        oph.success_rate AS health_success_rate,
        oph.error_count AS health_error_count
      FROM provider_configs pc
      LEFT JOIN orchestration_provider_health oph ON oph.provider = pc.provider
      WHERE pc.id = ${id}
    `;

    return result[0] ? this.mapProviderConfigWithHealth(result[0]) : null;
  }

  /**
   * Get provider with all models
   */
  async getProviderWithModels(id: UUID, tx?: TransactionContext): Promise<ProviderConfigWithModels | null> {
    const db = this.getSql(tx);

    const providerResult = await db`
      SELECT
        pc.*,
        pc.api_key_encrypted IS NOT NULL AS has_api_key
      FROM provider_configs pc
      WHERE pc.id = ${id}
    `;

    if (!providerResult[0]) return null;

    const modelsResult = await db`
      SELECT * FROM model_configs
      WHERE provider_config_id = ${id}
      ORDER BY display_name
    `;

    return {
      ...this.mapProviderConfigBase(providerResult[0]),
      has_api_key: Boolean(providerResult[0]['has_api_key']),
      models: modelsResult.map(row => this.mapModelConfig(row)),
    };
  }

  /**
   * Update a provider configuration
   */
  async updateProvider(
    id: UUID,
    update: ProviderConfigUpdate,
    encryptionKey: string,
    tx?: TransactionContext
  ): Promise<ProviderConfig> {
    const db = this.getSql(tx);

    // Build dynamic update - handle api_key specially for encryption
    const result = await db`
      UPDATE provider_configs
      SET
        display_name = COALESCE(${update.display_name ?? null}, display_name),
        is_enabled = COALESCE(${update.is_enabled ?? null}, is_enabled),
        api_key_encrypted = ${update.api_key !== undefined
          ? (update.api_key ? db`pgp_sym_encrypt(${update.api_key}, ${encryptionKey})` : null)
          : db`api_key_encrypted`},
        api_base_url = ${update.api_base_url !== undefined ? update.api_base_url : db`api_base_url`},
        rate_limit_rpm = ${update.rate_limit_rpm !== undefined ? update.rate_limit_rpm : db`rate_limit_rpm`},
        rate_limit_tpm = ${update.rate_limit_tpm !== undefined ? update.rate_limit_tpm : db`rate_limit_tpm`},
        max_concurrent_requests = COALESCE(${update.max_concurrent_requests ?? null}, max_concurrent_requests),
        priority = COALESCE(${update.priority ?? null}, priority),
        metadata = COALESCE(${update.metadata ? db.json(update.metadata as postgres.JSONValue) : null}, metadata)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('ProviderConfig', id);
    }

    logger.info({ providerId: id }, 'Provider config updated');
    return this.mapProviderConfig(result[0]);
  }

  /**
   * Delete a provider configuration
   */
  async deleteProvider(id: UUID, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM provider_configs WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('ProviderConfig', id);
    }

    logger.info({ providerId: id }, 'Provider config deleted');
  }

  /**
   * List providers with health status
   */
  async listProviders(
    filters: ProviderListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<ProviderConfigWithHealth>> {
    const db = this.getSql(tx);
    const { is_enabled, limit = 50, offset = 0 } = filters;

    const result = await db`
      SELECT
        pc.*,
        pc.api_key_encrypted IS NOT NULL AS has_api_key,
        (SELECT COUNT(*)::int FROM model_configs mc WHERE mc.provider_config_id = pc.id) AS model_count,
        oph.is_available AS health_is_available,
        oph.last_check_at AS health_last_check_at,
        oph.avg_latency_ms AS health_avg_latency_ms,
        oph.success_rate AS health_success_rate,
        oph.error_count AS health_error_count
      FROM provider_configs pc
      LEFT JOIN orchestration_provider_health oph ON oph.provider = pc.provider
      WHERE (${is_enabled ?? null}::boolean IS NULL OR pc.is_enabled = ${is_enabled ?? null})
      ORDER BY pc.priority ASC, pc.display_name ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapProviderConfigWithHealth(row));

    return { data, hasMore };
  }

  /**
   * Decrypt and retrieve the API key for a provider (for internal use only)
   */
  async getProviderApiKey(id: UUID, encryptionKey: string, tx?: TransactionContext): Promise<string | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT pgp_sym_decrypt(api_key_encrypted, ${encryptionKey}) AS api_key
      FROM provider_configs
      WHERE id = ${id} AND api_key_encrypted IS NOT NULL
    `;

    return result[0]?.api_key as string | null;
  }

  // ===========================================================================
  // Model Configs
  // ===========================================================================

  /**
   * Create a new model configuration
   */
  async createModel(input: ModelConfigInsert, tx?: TransactionContext): Promise<ModelConfig> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO model_configs (
          provider_config_id, model_id, display_name, is_enabled,
          context_window, max_output_tokens, input_cost_per_million,
          output_cost_per_million, capabilities, metadata
        )
        VALUES (
          ${input.provider_config_id},
          ${input.model_id},
          ${input.display_name},
          ${input.is_enabled ?? true},
          ${input.context_window ?? null},
          ${input.max_output_tokens ?? null},
          ${input.input_cost_per_million ?? null},
          ${input.output_cost_per_million ?? null},
          ${db.json((input.capabilities ?? []) as postgres.JSONValue)},
          ${input.metadata ? db.json(input.metadata as postgres.JSONValue) : db`'{}'::jsonb`}
        )
        RETURNING *
      `;

      const model = this.mapModelConfig(result[0]!);
      logger.info({ modelId: model.id, modelName: model.model_id }, 'Model config created');
      return model;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('ModelConfig', 'model_id', input.model_id);
      }
      throw wrapDatabaseError(error, 'providerSettings.createModel');
    }
  }

  /**
   * Get a model by ID
   */
  async getModelById(id: UUID, tx?: TransactionContext): Promise<ModelConfig | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM model_configs WHERE id = ${id}
    `;

    return result[0] ? this.mapModelConfig(result[0]) : null;
  }

  /**
   * Get a model by model_id string
   */
  async getModelByModelId(modelId: string, tx?: TransactionContext): Promise<ModelConfig | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM model_configs WHERE model_id = ${modelId}
      LIMIT 1
    `;

    return result[0] ? this.mapModelConfig(result[0]) : null;
  }

  /**
   * Get model with provider info
   */
  async getModelWithProvider(id: UUID, tx?: TransactionContext): Promise<ModelConfigWithProvider | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        mc.*,
        pc.provider,
        pc.display_name AS provider_display_name,
        pc.is_enabled AS provider_is_enabled
      FROM model_configs mc
      JOIN provider_configs pc ON pc.id = mc.provider_config_id
      WHERE mc.id = ${id}
    `;

    return result[0] ? this.mapModelConfigWithProvider(result[0]) : null;
  }

  /**
   * Update a model configuration
   */
  async updateModel(id: UUID, update: ModelConfigUpdate, tx?: TransactionContext): Promise<ModelConfig> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE model_configs
      SET
        display_name = COALESCE(${update.display_name ?? null}, display_name),
        is_enabled = COALESCE(${update.is_enabled ?? null}, is_enabled),
        context_window = ${update.context_window !== undefined ? update.context_window : db`context_window`},
        max_output_tokens = ${update.max_output_tokens !== undefined ? update.max_output_tokens : db`max_output_tokens`},
        input_cost_per_million = ${update.input_cost_per_million !== undefined ? update.input_cost_per_million : db`input_cost_per_million`},
        output_cost_per_million = ${update.output_cost_per_million !== undefined ? update.output_cost_per_million : db`output_cost_per_million`},
        capabilities = COALESCE(${update.capabilities ? db.json(update.capabilities as postgres.JSONValue) : null}, capabilities),
        metadata = COALESCE(${update.metadata ? db.json(update.metadata as postgres.JSONValue) : null}, metadata)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('ModelConfig', id);
    }

    logger.debug({ modelId: id }, 'Model config updated');
    return this.mapModelConfig(result[0]);
  }

  /**
   * Delete a model configuration
   */
  async deleteModel(id: UUID, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM model_configs WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('ModelConfig', id);
    }

    logger.info({ modelId: id }, 'Model config deleted');
  }

  /**
   * List models with optional filters
   */
  async listModels(
    filters: ModelListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<ModelConfigWithProvider>> {
    const db = this.getSql(tx);
    const { provider_config_id, is_enabled, limit = 100, offset = 0 } = filters;

    const result = await db`
      SELECT
        mc.*,
        pc.provider,
        pc.display_name AS provider_display_name,
        pc.is_enabled AS provider_is_enabled
      FROM model_configs mc
      JOIN provider_configs pc ON pc.id = mc.provider_config_id
      WHERE
        (${provider_config_id ?? null}::uuid IS NULL OR mc.provider_config_id = ${provider_config_id ?? null})
        AND (${is_enabled ?? null}::boolean IS NULL OR mc.is_enabled = ${is_enabled ?? null})
      ORDER BY pc.priority ASC, mc.display_name ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapModelConfigWithProvider(row));

    return { data, hasMore };
  }

  // ===========================================================================
  // Routing Rules
  // ===========================================================================

  /**
   * Create a routing rule
   */
  async createRoutingRule(input: RoutingRuleInsert, tx?: TransactionContext): Promise<RoutingRule> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO routing_rules (
          use_case, tier, model_config_id, weight,
          is_enabled, max_retries, timeout_ms, metadata
        )
        VALUES (
          ${input.use_case},
          ${input.tier ?? 1},
          ${input.model_config_id},
          ${input.weight ?? 100},
          ${input.is_enabled ?? true},
          ${input.max_retries ?? 2},
          ${input.timeout_ms ?? 30000},
          ${input.metadata ? db.json(input.metadata as postgres.JSONValue) : db`'{}'::jsonb`}
        )
        RETURNING *
      `;

      const rule = this.mapRoutingRule(result[0]!);
      logger.info({ ruleId: rule.id, useCase: rule.use_case, tier: rule.tier }, 'Routing rule created');
      return rule;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('RoutingRule', 'use_case+tier+model', `${input.use_case}+${input.tier}+${input.model_config_id}`);
      }
      throw wrapDatabaseError(error, 'providerSettings.createRoutingRule');
    }
  }

  /**
   * Get a routing rule by ID
   */
  async getRoutingRuleById(id: UUID, tx?: TransactionContext): Promise<RoutingRule | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM routing_rules WHERE id = ${id}
    `;

    return result[0] ? this.mapRoutingRule(result[0]) : null;
  }

  /**
   * Update a routing rule
   */
  async updateRoutingRule(id: UUID, update: RoutingRuleUpdate, tx?: TransactionContext): Promise<RoutingRule> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE routing_rules
      SET
        tier = COALESCE(${update.tier ?? null}, tier),
        weight = COALESCE(${update.weight ?? null}, weight),
        is_enabled = COALESCE(${update.is_enabled ?? null}, is_enabled),
        max_retries = COALESCE(${update.max_retries ?? null}, max_retries),
        timeout_ms = COALESCE(${update.timeout_ms ?? null}, timeout_ms),
        metadata = COALESCE(${update.metadata ? db.json(update.metadata as postgres.JSONValue) : null}, metadata)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('RoutingRule', id);
    }

    logger.debug({ ruleId: id }, 'Routing rule updated');
    return this.mapRoutingRule(result[0]);
  }

  /**
   * Delete a routing rule
   */
  async deleteRoutingRule(id: UUID, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM routing_rules WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('RoutingRule', id);
    }

    logger.info({ ruleId: id }, 'Routing rule deleted');
  }

  /**
   * List routing rules with model info
   */
  async listRoutingRules(
    filters: RoutingRuleListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<RoutingRuleWithModel>> {
    const db = this.getSql(tx);
    const { use_case, tier, is_enabled, limit = 100, offset = 0 } = filters;

    const result = await db`
      SELECT
        rr.*,
        mc.model_id,
        mc.display_name AS model_display_name,
        mc.is_enabled AS model_is_enabled,
        mc.context_window,
        mc.max_output_tokens,
        mc.input_cost_per_million,
        mc.output_cost_per_million,
        mc.capabilities,
        mc.metadata AS model_metadata,
        mc.created_at AS model_created_at,
        mc.updated_at AS model_updated_at,
        pc.provider,
        pc.display_name AS provider_display_name,
        pc.is_enabled AS provider_is_enabled
      FROM routing_rules rr
      JOIN model_configs mc ON mc.id = rr.model_config_id
      JOIN provider_configs pc ON pc.id = mc.provider_config_id
      WHERE
        (${use_case ?? null}::use_case_type IS NULL OR rr.use_case = ${use_case ?? null})
        AND (${tier ?? null}::int IS NULL OR rr.tier = ${tier ?? null})
        AND (${is_enabled ?? null}::boolean IS NULL OR rr.is_enabled = ${is_enabled ?? null})
      ORDER BY rr.use_case, rr.tier ASC, rr.weight DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapRoutingRuleWithModel(row));

    return { data, hasMore };
  }

  /**
   * Get routing rules for a specific use case
   */
  async getRoutingRulesForUseCase(
    useCase: UseCaseType,
    tx?: TransactionContext
  ): Promise<RoutingRuleWithModel[]> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT
        rr.*,
        mc.model_id,
        mc.display_name AS model_display_name,
        mc.is_enabled AS model_is_enabled,
        mc.context_window,
        mc.max_output_tokens,
        mc.input_cost_per_million,
        mc.output_cost_per_million,
        mc.capabilities,
        mc.metadata AS model_metadata,
        mc.created_at AS model_created_at,
        mc.updated_at AS model_updated_at,
        pc.provider,
        pc.display_name AS provider_display_name,
        pc.is_enabled AS provider_is_enabled
      FROM routing_rules rr
      JOIN model_configs mc ON mc.id = rr.model_config_id
      JOIN provider_configs pc ON pc.id = mc.provider_config_id
      WHERE rr.use_case = ${useCase} AND rr.is_enabled = TRUE
        AND mc.is_enabled = TRUE AND pc.is_enabled = TRUE
      ORDER BY rr.tier ASC, rr.weight DESC
    `;

    return result.map(row => this.mapRoutingRuleWithModel(row));
  }

  // ===========================================================================
  // Companion Routing Overrides
  // ===========================================================================

  /**
   * Create a companion routing override
   */
  async createCompanionOverride(
    input: CompanionRoutingOverrideInsert,
    tx?: TransactionContext
  ): Promise<CompanionRoutingOverride> {
    const db = this.getSql(tx);

    try {
      const result = await db`
        INSERT INTO companion_routing_overrides (
          companion_id, use_case, tier, model_config_id,
          weight, is_enabled, max_retries, timeout_ms
        )
        VALUES (
          ${input.companion_id},
          ${input.use_case},
          ${input.tier ?? 1},
          ${input.model_config_id},
          ${input.weight ?? 100},
          ${input.is_enabled ?? true},
          ${input.max_retries ?? null},
          ${input.timeout_ms ?? null}
        )
        RETURNING *
      `;

      const override = this.mapCompanionRoutingOverride(result[0]!);
      logger.info(
        { overrideId: override.id, companionId: override.companion_id, useCase: override.use_case },
        'Companion routing override created'
      );
      return override;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError(
          'CompanionRoutingOverride',
          'companion+use_case+tier+model',
          `${input.companion_id}+${input.use_case}+${input.tier}+${input.model_config_id}`
        );
      }
      throw wrapDatabaseError(error, 'providerSettings.createCompanionOverride');
    }
  }

  /**
   * Get a companion override by ID
   */
  async getCompanionOverrideById(id: UUID, tx?: TransactionContext): Promise<CompanionRoutingOverride | null> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM companion_routing_overrides WHERE id = ${id}
    `;

    return result[0] ? this.mapCompanionRoutingOverride(result[0]) : null;
  }

  /**
   * Update a companion override
   */
  async updateCompanionOverride(
    id: UUID,
    update: CompanionRoutingOverrideUpdate,
    tx?: TransactionContext
  ): Promise<CompanionRoutingOverride> {
    const db = this.getSql(tx);

    const result = await db`
      UPDATE companion_routing_overrides
      SET
        tier = COALESCE(${update.tier ?? null}, tier),
        weight = COALESCE(${update.weight ?? null}, weight),
        is_enabled = COALESCE(${update.is_enabled ?? null}, is_enabled),
        max_retries = ${update.max_retries !== undefined ? update.max_retries : db`max_retries`},
        timeout_ms = ${update.timeout_ms !== undefined ? update.timeout_ms : db`timeout_ms`}
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('CompanionRoutingOverride', id);
    }

    logger.debug({ overrideId: id }, 'Companion routing override updated');
    return this.mapCompanionRoutingOverride(result[0]);
  }

  /**
   * Delete a companion override
   */
  async deleteCompanionOverride(id: UUID, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM companion_routing_overrides WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('CompanionRoutingOverride', id);
    }

    logger.info({ overrideId: id }, 'Companion routing override deleted');
  }

  /**
   * List companion overrides
   */
  async listCompanionOverrides(
    filters: CompanionOverrideListFilters,
    tx?: TransactionContext
  ): Promise<PaginatedResult<CompanionRoutingOverride>> {
    const db = this.getSql(tx);
    const { companion_id, use_case, limit = 100, offset = 0 } = filters;

    const result = await db`
      SELECT * FROM companion_routing_overrides
      WHERE
        companion_id = ${companion_id}
        AND (${use_case ?? null}::use_case_type IS NULL OR use_case = ${use_case ?? null})
      ORDER BY use_case, tier ASC, weight DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    const data = result.slice(0, limit).map(row => this.mapCompanionRoutingOverride(row));

    return { data, hasMore };
  }

  /**
   * Delete all overrides for a companion
   */
  async deleteAllCompanionOverrides(companionId: UUID, tx?: TransactionContext): Promise<number> {
    const db = this.getSql(tx);

    const result = await db`
      DELETE FROM companion_routing_overrides
      WHERE companion_id = ${companionId}
      RETURNING id
    `;

    logger.info({ companionId, count: result.length }, 'All companion overrides deleted');
    return result.length;
  }

  // ===========================================================================
  // Effective Routing Resolution
  // ===========================================================================

  /**
   * Get the effective routing configuration for a companion and use case
   * Uses the database function for efficient resolution
   */
  async getEffectiveRouting(
    companionId: UUID | null,
    useCase: UseCaseType,
    tx?: TransactionContext
  ): Promise<EffectiveRoutingConfig> {
    const db = this.getSql(tx);

    const result = await db`
      SELECT * FROM get_effective_routing(${companionId}, ${useCase})
    `;

    const entries: EffectiveRoutingEntry[] = result.map(row => ({
      tier: row['tier'] as number,
      model_config_id: row['model_config_id'] as UUID,
      model_id: row['model_id'] as string,
      provider: row['provider'] as string,
      weight: row['weight'] as number,
      max_retries: row['max_retries'] as number,
      timeout_ms: row['timeout_ms'] as number,
      is_override: row['is_override'] as boolean,
    }));

    return {
      companion_id: companionId,
      use_case: useCase,
      entries,
      has_overrides: entries.some(e => e.is_override),
    };
  }

  /**
   * Copy platform default routing rules to companion overrides
   */
  async copyPlatformDefaultsToCompanion(
    companionId: UUID,
    useCases?: UseCaseType[],
    tx?: TransactionContext
  ): Promise<CompanionRoutingOverride[]> {
    const db = this.getSql(tx);

    // Get platform rules to copy
    const whereClause = useCases && useCases.length > 0
      ? db`rr.use_case = ANY(${useCases})`
      : db`TRUE`;

    const platformRules = await db`
      SELECT * FROM routing_rules rr
      WHERE ${whereClause} AND rr.is_enabled = TRUE
    `;

    const overrides: CompanionRoutingOverride[] = [];

    for (const rule of platformRules) {
      try {
        const result = await db`
          INSERT INTO companion_routing_overrides (
            companion_id, use_case, tier, model_config_id,
            weight, is_enabled, max_retries, timeout_ms
          )
          VALUES (
            ${companionId},
            ${rule['use_case']},
            ${rule['tier']},
            ${rule['model_config_id']},
            ${rule['weight']},
            TRUE,
            ${rule['max_retries']},
            ${rule['timeout_ms']}
          )
          ON CONFLICT (companion_id, use_case, tier, model_config_id) DO NOTHING
          RETURNING *
        `;

        if (result[0]) {
          overrides.push(this.mapCompanionRoutingOverride(result[0]));
        }
      } catch (error) {
        // Skip duplicates silently
        logger.debug({ companionId, useCase: rule['use_case'] }, 'Skipped duplicate override');
      }
    }

    logger.info({ companionId, count: overrides.length }, 'Platform defaults copied to companion');
    return overrides;
  }

  // ===========================================================================
  // Row Mappers
  // ===========================================================================

  private mapProviderConfig(row: Record<string, unknown>): ProviderConfig {
    return {
      id: row['id'] as UUID,
      provider: row['provider'] as string,
      display_name: row['display_name'] as string,
      is_enabled: row['is_enabled'] as boolean,
      api_key_encrypted: row['api_key_encrypted'] as Buffer | null,
      api_base_url: row['api_base_url'] as string | null,
      rate_limit_rpm: row['rate_limit_rpm'] as number | null,
      rate_limit_tpm: row['rate_limit_tpm'] as number | null,
      max_concurrent_requests: row['max_concurrent_requests'] as number,
      priority: row['priority'] as number,
      metadata: (row['metadata'] ?? {}) as JSONObject,
      created_at: row['created_at'] as Timestamp,
      updated_at: row['updated_at'] as Timestamp,
    };
  }

  private mapProviderConfigBase(row: Record<string, unknown>): Omit<ProviderConfig, 'api_key_encrypted'> {
    return {
      id: row['id'] as UUID,
      provider: row['provider'] as string,
      display_name: row['display_name'] as string,
      is_enabled: row['is_enabled'] as boolean,
      api_base_url: row['api_base_url'] as string | null,
      rate_limit_rpm: row['rate_limit_rpm'] as number | null,
      rate_limit_tpm: row['rate_limit_tpm'] as number | null,
      max_concurrent_requests: row['max_concurrent_requests'] as number,
      priority: row['priority'] as number,
      metadata: (row['metadata'] ?? {}) as JSONObject,
      created_at: row['created_at'] as Timestamp,
      updated_at: row['updated_at'] as Timestamp,
    };
  }

  private mapProviderConfigWithHealth(row: Record<string, unknown>): ProviderConfigWithHealth {
    return {
      ...this.mapProviderConfigBase(row),
      has_api_key: Boolean(row['has_api_key']),
      model_count: (row['model_count'] as number) ?? 0,
      health: row['health_is_available'] !== null
        ? {
            is_available: row['health_is_available'] as boolean,
            last_check_at: row['health_last_check_at'] as Timestamp | null,
            avg_latency_ms: row['health_avg_latency_ms'] as number | null,
            success_rate: row['health_success_rate'] as number | null,
            error_count: (row['health_error_count'] as number) ?? 0,
          }
        : null,
    };
  }

  private mapModelConfig(row: Record<string, unknown>): ModelConfig {
    return {
      id: row['id'] as UUID,
      provider_config_id: row['provider_config_id'] as UUID,
      model_id: row['model_id'] as string,
      display_name: row['display_name'] as string,
      is_enabled: row['is_enabled'] as boolean,
      context_window: row['context_window'] as number | null,
      max_output_tokens: row['max_output_tokens'] as number | null,
      input_cost_per_million: row['input_cost_per_million'] as number | null,
      output_cost_per_million: row['output_cost_per_million'] as number | null,
      capabilities: (row['capabilities'] ?? []) as ModelCapability[],
      metadata: (row['metadata'] ?? {}) as JSONObject,
      created_at: row['created_at'] as Timestamp,
      updated_at: row['updated_at'] as Timestamp,
    };
  }

  private mapModelConfigWithProvider(row: Record<string, unknown>): ModelConfigWithProvider {
    return {
      ...this.mapModelConfig(row),
      provider: row['provider'] as string,
      provider_display_name: row['provider_display_name'] as string,
      provider_is_enabled: row['provider_is_enabled'] as boolean,
    };
  }

  private mapRoutingRule(row: Record<string, unknown>): RoutingRule {
    return {
      id: row['id'] as UUID,
      use_case: row['use_case'] as UseCaseType,
      tier: row['tier'] as number,
      model_config_id: row['model_config_id'] as UUID,
      weight: row['weight'] as number,
      is_enabled: row['is_enabled'] as boolean,
      max_retries: row['max_retries'] as number,
      timeout_ms: row['timeout_ms'] as number,
      metadata: (row['metadata'] ?? {}) as JSONObject,
      created_at: row['created_at'] as Timestamp,
      updated_at: row['updated_at'] as Timestamp,
    };
  }

  private mapRoutingRuleWithModel(row: Record<string, unknown>): RoutingRuleWithModel {
    return {
      ...this.mapRoutingRule(row),
      model: {
        id: row['model_config_id'] as UUID,
        provider_config_id: row['model_config_id'] as UUID, // Not directly available, would need join
        model_id: row['model_id'] as string,
        display_name: row['model_display_name'] as string,
        is_enabled: row['model_is_enabled'] as boolean,
        context_window: row['context_window'] as number | null,
        max_output_tokens: row['max_output_tokens'] as number | null,
        input_cost_per_million: row['input_cost_per_million'] as number | null,
        output_cost_per_million: row['output_cost_per_million'] as number | null,
        capabilities: (row['capabilities'] ?? []) as ModelCapability[],
        metadata: (row['model_metadata'] ?? {}) as JSONObject,
        created_at: row['model_created_at'] as Timestamp,
        updated_at: row['model_updated_at'] as Timestamp,
        provider: row['provider'] as string,
        provider_display_name: row['provider_display_name'] as string,
        provider_is_enabled: row['provider_is_enabled'] as boolean,
      },
    };
  }

  private mapCompanionRoutingOverride(row: Record<string, unknown>): CompanionRoutingOverride {
    return {
      id: row['id'] as UUID,
      companion_id: row['companion_id'] as UUID,
      use_case: row['use_case'] as UseCaseType,
      tier: row['tier'] as number,
      model_config_id: row['model_config_id'] as UUID,
      weight: row['weight'] as number,
      is_enabled: row['is_enabled'] as boolean,
      max_retries: row['max_retries'] as number | null,
      timeout_ms: row['timeout_ms'] as number | null,
      created_at: row['created_at'] as Timestamp,
      updated_at: row['updated_at'] as Timestamp,
    };
  }
}

// Singleton instance
let providerSettingsRepositoryInstance: ProviderSettingsRepository | null = null;

export function getProviderSettingsRepository(): ProviderSettingsRepository {
  if (!providerSettingsRepositoryInstance) {
    providerSettingsRepositoryInstance = new ProviderSettingsRepository();
  }
  return providerSettingsRepositoryInstance;
}
