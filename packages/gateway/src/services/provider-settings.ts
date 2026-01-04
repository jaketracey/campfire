/**
 * Provider Settings Service
 * Business logic for AI provider configurations, model settings, and routing rules.
 */

import { z } from 'zod';
import {
  getProviderSettingsRepository,
  getOrchestrationTestsRepository,
  type ProviderListFilters,
  type ModelListFilters,
  type RoutingRuleListFilters,
  type CompanionOverrideListFilters,
} from '../repositories/index.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';
import {
  USE_CASE_TYPES,
  IMAGE_USE_CASE_TYPES,
  type UUID,
  type UseCaseType,
  type ProviderConfig,
  type ProviderConfigInsert,
  type ProviderConfigUpdate,
  type ProviderConfigWithHealth,
  type ProviderConfigWithModels,
  type ModelConfig,
  type ModelConfigInsert,
  type ModelConfigUpdate,
  type ModelConfigWithProvider,
  type RoutingRule,
  type RoutingRuleInsert,
  type RoutingRuleUpdate,
  type RoutingRuleWithModel,
  type CompanionRoutingOverride,
  type CompanionRoutingOverrideInsert,
  type CompanionRoutingOverrideUpdate,
  type EffectiveRoutingConfig,
  type ProviderCategory,
} from '../db/types.js';

// ============================================================================
// Configuration
// ============================================================================

const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';

// SECURITY: Encryption key required in production - no defaults allowed
const providerKeyEncryptionSecretValue = process.env['PROVIDER_KEY_ENCRYPTION_SECRET'];
if (!providerKeyEncryptionSecretValue && NODE_ENV === 'production') {
  throw new Error('FATAL: PROVIDER_KEY_ENCRYPTION_SECRET environment variable is required in production');
}
const PROVIDER_KEY_ENCRYPTION_SECRET = providerKeyEncryptionSecretValue ?? 'dev-only-encryption-key-not-for-production';

// ============================================================================
// Validation Schemas
// ============================================================================

export const CreateProviderSchema = z.object({
  provider: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  isEnabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  apiBaseUrl: z.string().url().optional().nullable(),
  rateLimitRpm: z.number().int().positive().optional().nullable(),
  rateLimitTpm: z.number().int().positive().optional().nullable(),
  maxConcurrentRequests: z.number().int().positive().max(100).default(10),
  priority: z.number().int().min(0).default(0),
});

export const UpdateProviderSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isEnabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  apiBaseUrl: z.string().url().optional().nullable(),
  rateLimitRpm: z.number().int().positive().optional().nullable(),
  rateLimitTpm: z.number().int().positive().optional().nullable(),
  maxConcurrentRequests: z.number().int().positive().max(100).optional(),
  priority: z.number().int().min(0).optional(),
});

export const CreateModelSchema = z.object({
  providerConfigId: z.string().uuid(),
  modelId: z.string().min(1).max(255),
  displayName: z.string().min(1).max(100),
  isEnabled: z.boolean().default(true),
  contextWindow: z.number().int().positive().optional().nullable(),
  maxOutputTokens: z.number().int().positive().optional().nullable(),
  inputCostPerMillion: z.number().min(0).optional().nullable(),
  outputCostPerMillion: z.number().min(0).optional().nullable(),
  capabilities: z.array(z.enum(['chat', 'vision', 'function_calling', 'streaming', 'json_mode'])).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateModelSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isEnabled: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional().nullable(),
  maxOutputTokens: z.number().int().positive().optional().nullable(),
  inputCostPerMillion: z.number().min(0).optional().nullable(),
  outputCostPerMillion: z.number().min(0).optional().nullable(),
  capabilities: z.array(z.enum(['chat', 'vision', 'function_calling', 'streaming', 'json_mode'])).optional(),
});

export const CreateRoutingRuleSchema = z.object({
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]),
  tier: z.number().int().min(1).max(3).default(1),
  modelConfigId: z.string().uuid(),
  weight: z.number().int().min(0).max(100).default(100),
  isEnabled: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(5).default(2),
  timeoutMs: z.number().int().min(1000).max(300000).default(30000),
});

export const UpdateRoutingRuleSchema = z.object({
  tier: z.number().int().min(1).max(3).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  isEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
});

export const CreateCompanionOverrideSchema = z.object({
  companionId: z.string().uuid(),
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]),
  tier: z.number().int().min(1).max(3).default(1),
  modelConfigId: z.string().uuid(),
  weight: z.number().int().min(0).max(100).default(100),
  isEnabled: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(5).optional().nullable(),
  timeoutMs: z.number().int().min(1000).max(300000).optional().nullable(),
});

export const UpdateCompanionOverrideSchema = z.object({
  tier: z.number().int().min(1).max(3).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  isEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(5).optional().nullable(),
  timeoutMs: z.number().int().min(1000).max(300000).optional().nullable(),
});

export const ProviderListQuerySchema = z.object({
  isEnabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const ModelListQuerySchema = z.object({
  providerConfigId: z.string().uuid().optional(),
  isEnabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
  offset: z.coerce.number().min(0).default(0),
});

export const RoutingRuleListQuerySchema = z.object({
  useCase: z.enum(USE_CASE_TYPES as unknown as [string, ...string[]]).optional(),
  tier: z.coerce.number().int().min(1).max(3).optional(),
  isEnabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
  offset: z.coerce.number().min(0).default(0),
});

// ============================================================================
// Types
// ============================================================================

export type CreateProviderInput = z.infer<typeof CreateProviderSchema>;
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>;
export type CreateModelInput = z.infer<typeof CreateModelSchema>;
export type UpdateModelInput = z.infer<typeof UpdateModelSchema>;
export type CreateRoutingRuleInput = z.infer<typeof CreateRoutingRuleSchema>;
export type UpdateRoutingRuleInput = z.infer<typeof UpdateRoutingRuleSchema>;
export type CreateCompanionOverrideInput = z.infer<typeof CreateCompanionOverrideSchema>;
export type UpdateCompanionOverrideInput = z.infer<typeof UpdateCompanionOverrideSchema>;
export type ProviderListQuery = z.infer<typeof ProviderListQuerySchema>;
export type ModelListQuery = z.infer<typeof ModelListQuerySchema>;
export type RoutingRuleListQuery = z.infer<typeof RoutingRuleListQuerySchema>;

export interface ConfigurationExport {
  version: string;
  exportedAt: string;
  providers: Array<Omit<ProviderConfig, 'api_key_encrypted'> & { has_api_key: boolean }>;
  models: ModelConfig[];
  routingRules: RoutingRule[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface SyncResult {
  success: boolean;
  synced: {
    providers: number;
    models: number;
    rules: number;
  };
  error: string | null;
}

// ============================================================================
// Service
// ============================================================================

export class ProviderSettingsService {
  private repo = getProviderSettingsRepository();
  private testsRepo = getOrchestrationTestsRepository();

  // ===========================================================================
  // Providers
  // ===========================================================================

  /**
   * Create a new provider configuration
   */
  async createProvider(input: CreateProviderInput, tx?: TransactionContext): Promise<ProviderConfig> {
    const validated = CreateProviderSchema.parse(input);

    const insert: ProviderConfigInsert = {
      provider: validated.provider,
      display_name: validated.displayName,
      is_enabled: validated.isEnabled,
      api_key: validated.apiKey,
      api_base_url: validated.apiBaseUrl,
      rate_limit_rpm: validated.rateLimitRpm,
      rate_limit_tpm: validated.rateLimitTpm,
      max_concurrent_requests: validated.maxConcurrentRequests,
      priority: validated.priority,
    };

    return this.repo.createProvider(insert, PROVIDER_KEY_ENCRYPTION_SECRET, tx);
  }

  /**
   * Get a provider by ID
   */
  async getProvider(id: UUID, tx?: TransactionContext): Promise<ProviderConfigWithHealth | null> {
    return this.repo.getProviderWithHealth(id, tx);
  }

  /**
   * Get a provider with all its models
   */
  async getProviderWithModels(id: UUID, tx?: TransactionContext): Promise<ProviderConfigWithModels | null> {
    return this.repo.getProviderWithModels(id, tx);
  }

  /**
   * Update a provider configuration
   */
  async updateProvider(id: UUID, input: UpdateProviderInput, tx?: TransactionContext): Promise<ProviderConfig> {
    const validated = UpdateProviderSchema.parse(input);

    const update: ProviderConfigUpdate = {};
    if (validated.displayName !== undefined) update.display_name = validated.displayName;
    if (validated.isEnabled !== undefined) update.is_enabled = validated.isEnabled;
    if (validated.apiKey !== undefined) update.api_key = validated.apiKey;
    if (validated.apiBaseUrl !== undefined) update.api_base_url = validated.apiBaseUrl;
    if (validated.rateLimitRpm !== undefined) update.rate_limit_rpm = validated.rateLimitRpm;
    if (validated.rateLimitTpm !== undefined) update.rate_limit_tpm = validated.rateLimitTpm;
    if (validated.maxConcurrentRequests !== undefined) update.max_concurrent_requests = validated.maxConcurrentRequests;
    if (validated.priority !== undefined) update.priority = validated.priority;

    return this.repo.updateProvider(id, update, PROVIDER_KEY_ENCRYPTION_SECRET, tx);
  }

  /**
   * Delete a provider configuration
   */
  async deleteProvider(id: UUID, tx?: TransactionContext): Promise<void> {
    return this.repo.deleteProvider(id, tx);
  }

  /**
   * List providers with health status
   */
  async listProviders(query: ProviderListQuery, tx?: TransactionContext): Promise<PaginatedResult<ProviderConfigWithHealth>> {
    const validated = ProviderListQuerySchema.parse(query);

    const filters: ProviderListFilters = {
      is_enabled: validated.isEnabled,
      limit: validated.limit,
      offset: validated.offset,
    };

    return this.repo.listProviders(filters, tx);
  }

  /**
   * Test provider connection
   */
  async testProviderConnection(id: UUID): Promise<ConnectionTestResult> {
    // Local providers that don't require API keys
    const LOCAL_PROVIDERS = ['ollama'];

    try {
      const provider = await this.repo.getProviderById(id);
      if (!provider) {
        return { success: false, latencyMs: null, error: 'Provider not found' };
      }

      const isLocalProvider = LOCAL_PROVIDERS.includes(provider.provider);
      const apiKey = await this.repo.getProviderApiKey(id, PROVIDER_KEY_ENCRYPTION_SECRET);

      // Only require API key for non-local providers
      if (!isLocalProvider && !apiKey) {
        return { success: false, latencyMs: null, error: 'No API key configured' };
      }

      // Try to call orchestrator to test the provider
      const startTime = Date.now();
      const response = await fetch(`${ORCHESTRATOR_URL}/providers/${provider.provider}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey || null }),
        signal: AbortSignal.timeout(30000), // Longer timeout for Ollama cold starts
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, latencyMs, error: `API returned ${response.status}: ${errorText}` };
      }

      // Parse the response to get detailed result
      const result = (await response.json()) as {
        success?: boolean;
        latency_ms?: number;
        error?: string | null;
      };
      return {
        success: result.success ?? true,
        latencyMs: result.latency_ms ?? latencyMs,
        error: result.error ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, latencyMs: null, error: message };
    }
  }

  // ===========================================================================
  // Models
  // ===========================================================================

  /**
   * Create a new model configuration
   */
  async createModel(input: CreateModelInput, tx?: TransactionContext): Promise<ModelConfig> {
    const validated = CreateModelSchema.parse(input);

    const insert: ModelConfigInsert = {
      provider_config_id: validated.providerConfigId,
      model_id: validated.modelId,
      display_name: validated.displayName,
      is_enabled: validated.isEnabled,
      context_window: validated.contextWindow,
      max_output_tokens: validated.maxOutputTokens,
      input_cost_per_million: validated.inputCostPerMillion,
      output_cost_per_million: validated.outputCostPerMillion,
      capabilities: validated.capabilities,
      metadata: validated.metadata,
    };

    return this.repo.createModel(insert, tx);
  }

  /**
   * Get a model by ID
   */
  async getModel(id: UUID, tx?: TransactionContext): Promise<ModelConfigWithProvider | null> {
    return this.repo.getModelWithProvider(id, tx);
  }

  /**
   * Update a model configuration
   */
  async updateModel(id: UUID, input: UpdateModelInput, tx?: TransactionContext): Promise<ModelConfig> {
    const validated = UpdateModelSchema.parse(input);

    const update: ModelConfigUpdate = {};
    if (validated.displayName !== undefined) update.display_name = validated.displayName;
    if (validated.isEnabled !== undefined) update.is_enabled = validated.isEnabled;
    if (validated.contextWindow !== undefined) update.context_window = validated.contextWindow;
    if (validated.maxOutputTokens !== undefined) update.max_output_tokens = validated.maxOutputTokens;
    if (validated.inputCostPerMillion !== undefined) update.input_cost_per_million = validated.inputCostPerMillion;
    if (validated.outputCostPerMillion !== undefined) update.output_cost_per_million = validated.outputCostPerMillion;
    if (validated.capabilities !== undefined) update.capabilities = validated.capabilities;

    return this.repo.updateModel(id, update, tx);
  }

  /**
   * Delete a model configuration
   */
  async deleteModel(id: UUID, tx?: TransactionContext): Promise<void> {
    return this.repo.deleteModel(id, tx);
  }

  /**
   * List models with provider info
   */
  async listModels(query: ModelListQuery, tx?: TransactionContext): Promise<PaginatedResult<ModelConfigWithProvider>> {
    const validated = ModelListQuerySchema.parse(query);

    const filters: ModelListFilters = {
      provider_config_id: validated.providerConfigId,
      is_enabled: validated.isEnabled,
      limit: validated.limit,
      offset: validated.offset,
    };

    return this.repo.listModels(filters, tx);
  }

  /**
   * Discover available models from a provider's API
   */
  async discoverProviderModels(providerId: UUID): Promise<{
    success: boolean;
    models: Array<{
      modelId: string;
      displayName: string;
      contextWindow?: number;
      maxOutputTokens?: number;
      inputCostPerMillion?: number;
      outputCostPerMillion?: number;
      capabilities?: string[];
    }>;
    error?: string;
  }> {
    const { discoverModels } = await import('../utils/provider-model-discovery.js');

    const provider = await this.repo.getProviderById(providerId);
    if (!provider) {
      return { success: false, models: [], error: 'Provider not found' };
    }

    const apiKey = await this.repo.getProviderApiKey(providerId, PROVIDER_KEY_ENCRYPTION_SECRET);
    const result = await discoverModels(provider.provider, apiKey, provider.api_base_url);

    return result;
  }

  // ===========================================================================
  // Routing Rules
  // ===========================================================================

  /**
   * Create a routing rule
   */
  async createRoutingRule(input: CreateRoutingRuleInput, tx?: TransactionContext): Promise<RoutingRule> {
    const validated = CreateRoutingRuleSchema.parse(input);

    const insert: RoutingRuleInsert = {
      use_case: validated.useCase as UseCaseType,
      tier: validated.tier,
      model_config_id: validated.modelConfigId,
      weight: validated.weight,
      is_enabled: validated.isEnabled,
      max_retries: validated.maxRetries,
      timeout_ms: validated.timeoutMs,
    };

    return this.repo.createRoutingRule(insert, tx);
  }

  /**
   * Get a routing rule by ID
   */
  async getRoutingRule(id: UUID, tx?: TransactionContext): Promise<RoutingRule | null> {
    return this.repo.getRoutingRuleById(id, tx);
  }

  /**
   * Update a routing rule
   */
  async updateRoutingRule(id: UUID, input: UpdateRoutingRuleInput, tx?: TransactionContext): Promise<RoutingRule> {
    const validated = UpdateRoutingRuleSchema.parse(input);

    const update: RoutingRuleUpdate = {};
    if (validated.tier !== undefined) update.tier = validated.tier;
    if (validated.weight !== undefined) update.weight = validated.weight;
    if (validated.isEnabled !== undefined) update.is_enabled = validated.isEnabled;
    if (validated.maxRetries !== undefined) update.max_retries = validated.maxRetries;
    if (validated.timeoutMs !== undefined) update.timeout_ms = validated.timeoutMs;

    return this.repo.updateRoutingRule(id, update, tx);
  }

  /**
   * Delete a routing rule
   */
  async deleteRoutingRule(id: UUID, tx?: TransactionContext): Promise<void> {
    return this.repo.deleteRoutingRule(id, tx);
  }

  /**
   * List routing rules
   */
  async listRoutingRules(query: RoutingRuleListQuery, tx?: TransactionContext): Promise<PaginatedResult<RoutingRuleWithModel>> {
    const validated = RoutingRuleListQuerySchema.parse(query);

    const filters: RoutingRuleListFilters = {
      use_case: validated.useCase as UseCaseType | undefined,
      tier: validated.tier,
      is_enabled: validated.isEnabled,
      limit: validated.limit,
      offset: validated.offset,
    };

    return this.repo.listRoutingRules(filters, tx);
  }

  /**
   * Get routing rules for a specific use case
   */
  async getRoutingRulesForUseCase(useCase: UseCaseType, tx?: TransactionContext): Promise<RoutingRuleWithModel[]> {
    return this.repo.getRoutingRulesForUseCase(useCase, tx);
  }

  // ===========================================================================
  // Companion Overrides
  // ===========================================================================

  /**
   * Create a companion routing override
   */
  async createCompanionOverride(input: CreateCompanionOverrideInput, tx?: TransactionContext): Promise<CompanionRoutingOverride> {
    const validated = CreateCompanionOverrideSchema.parse(input);

    const insert: CompanionRoutingOverrideInsert = {
      companion_id: validated.companionId,
      use_case: validated.useCase as UseCaseType,
      tier: validated.tier,
      model_config_id: validated.modelConfigId,
      weight: validated.weight,
      is_enabled: validated.isEnabled,
      max_retries: validated.maxRetries,
      timeout_ms: validated.timeoutMs,
    };

    return this.repo.createCompanionOverride(insert, tx);
  }

  /**
   * Get a companion override by ID
   */
  async getCompanionOverride(id: UUID, tx?: TransactionContext): Promise<CompanionRoutingOverride | null> {
    return this.repo.getCompanionOverrideById(id, tx);
  }

  /**
   * Update a companion override
   */
  async updateCompanionOverride(id: UUID, input: UpdateCompanionOverrideInput, tx?: TransactionContext): Promise<CompanionRoutingOverride> {
    const validated = UpdateCompanionOverrideSchema.parse(input);

    const update: CompanionRoutingOverrideUpdate = {};
    if (validated.tier !== undefined) update.tier = validated.tier;
    if (validated.weight !== undefined) update.weight = validated.weight;
    if (validated.isEnabled !== undefined) update.is_enabled = validated.isEnabled;
    if (validated.maxRetries !== undefined) update.max_retries = validated.maxRetries;
    if (validated.timeoutMs !== undefined) update.timeout_ms = validated.timeoutMs;

    return this.repo.updateCompanionOverride(id, update, tx);
  }

  /**
   * Delete a companion override
   */
  async deleteCompanionOverride(id: UUID, tx?: TransactionContext): Promise<void> {
    return this.repo.deleteCompanionOverride(id, tx);
  }

  /**
   * List companion overrides
   */
  async listCompanionOverrides(
    companionId: UUID,
    useCase?: UseCaseType,
    tx?: TransactionContext
  ): Promise<PaginatedResult<CompanionRoutingOverride>> {
    const filters: CompanionOverrideListFilters = {
      companion_id: companionId,
      use_case: useCase,
    };

    return this.repo.listCompanionOverrides(filters, tx);
  }

  /**
   * Copy platform defaults to a companion
   */
  async copyPlatformDefaultsToCompanion(
    companionId: UUID,
    useCases?: UseCaseType[],
    tx?: TransactionContext
  ): Promise<CompanionRoutingOverride[]> {
    return this.repo.copyPlatformDefaultsToCompanion(companionId, useCases, tx);
  }

  /**
   * Delete all overrides for a companion
   */
  async deleteAllCompanionOverrides(companionId: UUID, tx?: TransactionContext): Promise<number> {
    return this.repo.deleteAllCompanionOverrides(companionId, tx);
  }

  // ===========================================================================
  // Effective Routing Resolution
  // ===========================================================================

  /**
   * Get the effective routing configuration for a companion and use case
   */
  async getEffectiveRouting(
    companionId: UUID | null,
    useCase: UseCaseType,
    tx?: TransactionContext
  ): Promise<EffectiveRoutingConfig> {
    return this.repo.getEffectiveRouting(companionId, useCase, tx);
  }

  // ===========================================================================
  // Configuration Management
  // ===========================================================================

  /**
   * Validate the current configuration
   */
  async validateConfiguration(tx?: TransactionContext): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check each use case has at least one enabled model
    for (const useCase of USE_CASE_TYPES) {
      const rules = await this.repo.getRoutingRulesForUseCase(useCase as UseCaseType, tx);
      if (rules.length === 0) {
        warnings.push(`Use case '${useCase}' has no routing rules configured`);
      }
    }

    // Check all providers have at least one enabled model
    const { data: providers } = await this.repo.listProviders({ is_enabled: true }, tx);
    for (const provider of providers) {
      if (provider.model_count === 0) {
        warnings.push(`Provider '${provider.display_name}' has no models configured`);
      }
      if (!provider.has_api_key) {
        warnings.push(`Provider '${provider.display_name}' has no API key configured`);
      }
    }

    // Check for enabled models that reference disabled providers
    const { data: models } = await this.repo.listModels({ is_enabled: true }, tx);
    for (const model of models) {
      if (!model.provider_is_enabled) {
        warnings.push(`Model '${model.display_name}' is enabled but provider '${model.provider}' is disabled`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Export current configuration
   */
  async exportConfiguration(tx?: TransactionContext): Promise<ConfigurationExport> {
    const { data: providers } = await this.repo.listProviders({}, tx);
    const { data: models } = await this.repo.listModels({}, tx);
    const { data: rules } = await this.repo.listRoutingRules({}, tx);

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      providers: providers.map(p => ({
        id: p.id,
        provider: p.provider,
        display_name: p.display_name,
        is_enabled: p.is_enabled,
        api_base_url: p.api_base_url,
        rate_limit_rpm: p.rate_limit_rpm,
        rate_limit_tpm: p.rate_limit_tpm,
        max_concurrent_requests: p.max_concurrent_requests,
        priority: p.priority,
        metadata: p.metadata,
        created_at: p.created_at,
        updated_at: p.updated_at,
        has_api_key: p.has_api_key,
      })),
      models: models.map(m => ({
        id: m.id,
        provider_config_id: m.provider_config_id,
        model_id: m.model_id,
        display_name: m.display_name,
        is_enabled: m.is_enabled,
        context_window: m.context_window,
        max_output_tokens: m.max_output_tokens,
        input_cost_per_million: m.input_cost_per_million,
        output_cost_per_million: m.output_cost_per_million,
        capabilities: m.capabilities,
        metadata: m.metadata,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
      routingRules: rules.map(r => ({
        id: r.id,
        use_case: r.use_case,
        tier: r.tier,
        model_config_id: r.model_config_id,
        weight: r.weight,
        is_enabled: r.is_enabled,
        max_retries: r.max_retries,
        timeout_ms: r.timeout_ms,
        metadata: r.metadata,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    };
  }

  /**
   * Sync configuration to orchestrator
   */
  async syncWithOrchestrator(tx?: TransactionContext): Promise<SyncResult> {
    try {
      const config = await this.exportConfiguration(tx);

      const response = await fetch(`${ORCHESTRATOR_URL}/config/routing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Orchestrator returned ${response.status}: ${errorText}`);
      }

      logger.info(
        {
          providers: config.providers.length,
          models: config.models.length,
          rules: config.routingRules.length,
        },
        'Configuration synced to orchestrator'
      );

      return {
        success: true,
        synced: {
          providers: config.providers.length,
          models: config.models.length,
          rules: config.routingRules.length,
        },
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Failed to sync configuration to orchestrator');
      return {
        success: false,
        synced: { providers: 0, models: 0, rules: 0 },
        error: message,
      };
    }
  }

  // ===========================================================================
  // Image Providers
  // ===========================================================================

  /**
   * List image providers (category='image')
   */
  async listImageProviders(query: ProviderListQuery, tx?: TransactionContext): Promise<PaginatedResult<ProviderConfigWithHealth>> {
    const validated = ProviderListQuerySchema.parse(query);

    const filters: ProviderListFilters = {
      is_enabled: validated.isEnabled,
      category: 'image',
      limit: validated.limit,
      offset: validated.offset,
    };

    return this.repo.listProviders(filters, tx);
  }

  /**
   * Get an image provider by ID
   */
  async getImageProvider(id: UUID, tx?: TransactionContext): Promise<ProviderConfigWithHealth | null> {
    const provider = await this.repo.getProviderWithHealth(id, tx);
    if (!provider) return null;

    // Verify it's an image provider by checking metadata category
    const category = (provider.metadata?.category as ProviderCategory) ?? 'text';
    if (category !== 'image') {
      return null;
    }

    return provider;
  }

  /**
   * Get an image provider with all its models
   */
  async getImageProviderWithModels(id: UUID, tx?: TransactionContext): Promise<ProviderConfigWithModels | null> {
    const provider = await this.repo.getProviderWithModels(id, tx);
    if (!provider) return null;

    // Verify it's an image provider
    const category = (provider.metadata?.category as ProviderCategory) ?? 'text';
    if (category !== 'image') {
      return null;
    }

    return provider;
  }

  /**
   * Create a new image provider configuration
   */
  async createImageProvider(input: CreateProviderInput, tx?: TransactionContext): Promise<ProviderConfig> {
    const validated = CreateProviderSchema.parse(input);

    const insert: ProviderConfigInsert = {
      provider: validated.provider,
      display_name: validated.displayName,
      is_enabled: validated.isEnabled,
      api_key: validated.apiKey,
      api_base_url: validated.apiBaseUrl,
      rate_limit_rpm: validated.rateLimitRpm,
      rate_limit_tpm: validated.rateLimitTpm,
      max_concurrent_requests: validated.maxConcurrentRequests,
      priority: validated.priority,
      metadata: { category: 'image' as ProviderCategory },
    };

    return this.repo.createProvider(insert, PROVIDER_KEY_ENCRYPTION_SECRET, tx);
  }

  /**
   * Update an image provider configuration
   */
  async updateImageProvider(id: UUID, input: UpdateProviderInput, tx?: TransactionContext): Promise<ProviderConfig> {
    // Verify it's an image provider first
    const existing = await this.getImageProvider(id, tx);
    if (!existing) {
      throw new Error('Image provider not found');
    }

    const validated = UpdateProviderSchema.parse(input);

    const update: ProviderConfigUpdate = {};
    if (validated.displayName !== undefined) update.display_name = validated.displayName;
    if (validated.isEnabled !== undefined) update.is_enabled = validated.isEnabled;
    if (validated.apiKey !== undefined) update.api_key = validated.apiKey;
    if (validated.apiBaseUrl !== undefined) update.api_base_url = validated.apiBaseUrl;
    if (validated.rateLimitRpm !== undefined) update.rate_limit_rpm = validated.rateLimitRpm;
    if (validated.rateLimitTpm !== undefined) update.rate_limit_tpm = validated.rateLimitTpm;
    if (validated.maxConcurrentRequests !== undefined) update.max_concurrent_requests = validated.maxConcurrentRequests;
    if (validated.priority !== undefined) update.priority = validated.priority;

    return this.repo.updateProvider(id, update, PROVIDER_KEY_ENCRYPTION_SECRET, tx);
  }

  /**
   * Delete an image provider configuration
   */
  async deleteImageProvider(id: UUID, tx?: TransactionContext): Promise<void> {
    // Verify it's an image provider first
    const existing = await this.getImageProvider(id, tx);
    if (!existing) {
      throw new Error('Image provider not found');
    }

    return this.repo.deleteProvider(id, tx);
  }

  /**
   * Test image provider connection
   */
  async testImageProviderConnection(id: UUID): Promise<ConnectionTestResult> {
    // Image providers that don't require API keys
    const LOCAL_IMAGE_PROVIDERS = ['comfyui'];

    try {
      const provider = await this.repo.getProviderById(id);
      if (!provider) {
        return { success: false, latencyMs: null, error: 'Provider not found' };
      }

      // Verify it's an image provider
      const category = (provider.metadata?.category as ProviderCategory) ?? 'text';
      if (category !== 'image') {
        return { success: false, latencyMs: null, error: 'Not an image provider' };
      }

      const isLocalProvider = LOCAL_IMAGE_PROVIDERS.includes(provider.provider);
      const apiKey = await this.repo.getProviderApiKey(id, PROVIDER_KEY_ENCRYPTION_SECRET);

      // Only require API key for non-local providers
      if (!isLocalProvider && !apiKey) {
        return { success: false, latencyMs: null, error: 'No API key configured' };
      }

      // Try to call orchestrator to test the image provider
      const startTime = Date.now();
      const response = await fetch(`${ORCHESTRATOR_URL}/imagegen/providers/${provider.provider}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey || null }),
        signal: AbortSignal.timeout(30000),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, latencyMs, error: `API returned ${response.status}: ${errorText}` };
      }

      const result = (await response.json()) as {
        success?: boolean;
        latency_ms?: number;
        error?: string | null;
      };
      return {
        success: result.success ?? true,
        latencyMs: result.latency_ms ?? latencyMs,
        error: result.error ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, latencyMs: null, error: message };
    }
  }

  // ===========================================================================
  // Image Models
  // ===========================================================================

  /**
   * List image models for an image provider
   */
  async listImageModels(providerConfigId: UUID, query: ModelListQuery, tx?: TransactionContext): Promise<PaginatedResult<ModelConfigWithProvider>> {
    const validated = ModelListQuerySchema.parse(query);

    const filters: ModelListFilters = {
      provider_config_id: providerConfigId,
      is_enabled: validated.isEnabled,
      limit: validated.limit,
      offset: validated.offset,
    };

    return this.repo.listModels(filters, tx);
  }

  /**
   * Create a new image model configuration
   */
  async createImageModel(input: CreateModelInput, tx?: TransactionContext): Promise<ModelConfig> {
    const validated = CreateModelSchema.parse(input);

    // Verify the provider is an image provider
    const provider = await this.getImageProvider(validated.providerConfigId, tx);
    if (!provider) {
      throw new Error('Image provider not found');
    }

    const insert: ModelConfigInsert = {
      provider_config_id: validated.providerConfigId,
      model_id: validated.modelId,
      display_name: validated.displayName,
      is_enabled: validated.isEnabled,
      context_window: validated.contextWindow,
      max_output_tokens: validated.maxOutputTokens,
      input_cost_per_million: validated.inputCostPerMillion,
      output_cost_per_million: validated.outputCostPerMillion,
      capabilities: validated.capabilities,
      metadata: validated.metadata,
    };

    return this.repo.createModel(insert, tx);
  }

  // ===========================================================================
  // Image Routing Rules
  // ===========================================================================

  /**
   * List image routing rules (filter by image use cases)
   */
  async listImageRoutingRules(query: RoutingRuleListQuery, tx?: TransactionContext): Promise<PaginatedResult<RoutingRuleWithModel>> {
    const validated = RoutingRuleListQuerySchema.parse(query);

    // If a specific use case is provided, validate it's an image use case
    if (validated.useCase && !IMAGE_USE_CASE_TYPES.includes(validated.useCase as UseCaseType)) {
      return { data: [], hasMore: false };
    }

    const filters: RoutingRuleListFilters = {
      use_case: validated.useCase as UseCaseType | undefined,
      tier: validated.tier,
      is_enabled: validated.isEnabled,
      limit: validated.limit,
      offset: validated.offset,
      use_case_filter: IMAGE_USE_CASE_TYPES, // Filter to only image use cases
    };

    return this.repo.listRoutingRules(filters, tx);
  }

  /**
   * Create an image routing rule
   */
  async createImageRoutingRule(input: CreateRoutingRuleInput, tx?: TransactionContext): Promise<RoutingRule> {
    const validated = CreateRoutingRuleSchema.parse(input);

    // Validate it's an image use case
    if (!IMAGE_USE_CASE_TYPES.includes(validated.useCase as UseCaseType)) {
      throw new Error(`Invalid image use case: ${validated.useCase}. Valid options: ${IMAGE_USE_CASE_TYPES.join(', ')}`);
    }

    const insert: RoutingRuleInsert = {
      use_case: validated.useCase as UseCaseType,
      tier: validated.tier,
      model_config_id: validated.modelConfigId,
      weight: validated.weight,
      is_enabled: validated.isEnabled,
      max_retries: validated.maxRetries,
      timeout_ms: validated.timeoutMs,
    };

    return this.repo.createRoutingRule(insert, tx);
  }

  /**
   * Get image routing rules for a specific use case
   */
  async getImageRoutingRulesForUseCase(useCase: UseCaseType, tx?: TransactionContext): Promise<RoutingRuleWithModel[]> {
    // Validate it's an image use case
    if (!IMAGE_USE_CASE_TYPES.includes(useCase)) {
      return [];
    }

    return this.repo.getRoutingRulesForUseCase(useCase, tx);
  }

  /**
   * Sync image configuration to orchestrator
   */
  async syncImageConfigWithOrchestrator(tx?: TransactionContext): Promise<SyncResult> {
    try {
      // Get only image providers
      const { data: providers } = await this.listImageProviders({ limit: 100, offset: 0 }, tx);
      const { data: rules } = await this.listImageRoutingRules({ limit: 100, offset: 0 }, tx);

      // Get models for image providers
      const models: ModelConfig[] = [];
      for (const provider of providers) {
        const providerWithModels = await this.getImageProviderWithModels(provider.id, tx);
        if (providerWithModels) {
          models.push(...providerWithModels.models);
        }
      }

      const config = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        type: 'image',
        providers: providers.map(p => ({
          id: p.id,
          provider: p.provider,
          display_name: p.display_name,
          is_enabled: p.is_enabled,
          api_base_url: p.api_base_url,
          rate_limit_rpm: p.rate_limit_rpm,
          rate_limit_tpm: p.rate_limit_tpm,
          max_concurrent_requests: p.max_concurrent_requests,
          priority: p.priority,
          metadata: p.metadata,
          has_api_key: p.has_api_key,
        })),
        models: models.map(m => ({
          id: m.id,
          provider_config_id: m.provider_config_id,
          model_id: m.model_id,
          display_name: m.display_name,
          is_enabled: m.is_enabled,
          context_window: m.context_window,
          max_output_tokens: m.max_output_tokens,
          input_cost_per_million: m.input_cost_per_million,
          output_cost_per_million: m.output_cost_per_million,
          capabilities: m.capabilities,
          metadata: m.metadata,
        })),
        routingRules: rules.map(r => ({
          id: r.id,
          use_case: r.use_case,
          tier: r.tier,
          model_config_id: r.model_config_id,
          weight: r.weight,
          is_enabled: r.is_enabled,
          max_retries: r.max_retries,
          timeout_ms: r.timeout_ms,
          metadata: r.metadata,
        })),
      };

      const response = await fetch(`${ORCHESTRATOR_URL}/config/image-routing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Orchestrator returned ${response.status}: ${errorText}`);
      }

      logger.info(
        {
          providers: providers.length,
          models: models.length,
          rules: rules.length,
        },
        'Image configuration synced to orchestrator'
      );

      return {
        success: true,
        synced: {
          providers: providers.length,
          models: models.length,
          rules: rules.length,
        },
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Failed to sync image configuration to orchestrator');
      return {
        success: false,
        synced: { providers: 0, models: 0, rules: 0 },
        error: message,
      };
    }
  }
}

// Singleton
let providerSettingsService: ProviderSettingsService | null = null;

export function getProviderSettingsService(): ProviderSettingsService {
  if (!providerSettingsService) {
    providerSettingsService = new ProviderSettingsService();
  }
  return providerSettingsService;
}
