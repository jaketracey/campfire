/**
 * Provider Settings API
 * Administrative operations for AI provider configurations and routing.
 */

import { get, post, patch, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type UseCaseType =
  | 'chat_simple'
  | 'chat_complex'
  | 'memory_extraction'
  | 'summarization'
  | 'context_compression'
  | 'safety_check'
  | 'content_moderation';

export const USE_CASE_TYPES: UseCaseType[] = [
  'chat_simple',
  'chat_complex',
  'memory_extraction',
  'summarization',
  'context_compression',
  'safety_check',
  'content_moderation',
];

export const USE_CASE_LABELS: Record<UseCaseType, string> = {
  chat_simple: 'Simple Chat',
  chat_complex: 'Complex Chat',
  memory_extraction: 'Memory Extraction',
  summarization: 'Summarization',
  context_compression: 'Context Compression',
  safety_check: 'Safety Check',
  content_moderation: 'Content Moderation',
};

export type ModelCapability = 'chat' | 'vision' | 'function_calling' | 'streaming' | 'json_mode';

export interface ProviderHealth {
  isAvailable: boolean;
  lastCheckAt: string | null;
  avgLatencyMs: number | null;
  successRate: number | null;
  errorCount: number;
}

export interface Provider {
  id: string;
  provider: string;
  displayName: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  apiBaseUrl: string | null;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  maxConcurrentRequests: number;
  priority: number;
  modelCount: number;
  health: ProviderHealth | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithModels extends Omit<Provider, 'modelCount' | 'health'> {
  metadata: Record<string, unknown>;
  models: Model[];
}

export interface Model {
  id: string;
  providerConfigId: string;
  modelId: string;
  displayName: string;
  isEnabled: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
  capabilities: ModelCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelWithProvider extends Model {
  provider: string;
  providerDisplayName: string;
  providerIsEnabled: boolean;
}

export interface RoutingRule {
  id: string;
  useCase: UseCaseType;
  tier: number;
  modelConfigId: string;
  weight: number;
  isEnabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  model: {
    id: string;
    modelId: string;
    displayName: string;
    isEnabled: boolean;
    provider: string;
    providerDisplayName: string;
    providerIsEnabled: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanionOverride {
  id: string;
  companionId: string;
  useCase: UseCaseType;
  tier: number;
  modelConfigId: string;
  weight: number;
  isEnabled: boolean;
  maxRetries: number | null;
  timeoutMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveRoutingEntry {
  tier: number;
  modelConfigId: string;
  modelId: string;
  provider: string;
  weight: number;
  maxRetries: number;
  timeoutMs: number;
  isOverride: boolean;
}

export interface EffectiveRoutingConfig {
  companionId: string | null;
  useCase: UseCaseType;
  hasOverrides: boolean;
  entries: EffectiveRoutingEntry[];
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

export interface ConfigurationExport {
  version: string;
  exportedAt: string;
  providers: Array<Omit<Provider, 'health' | 'modelCount'>>;
  models: Model[];
  routingRules: Omit<RoutingRule, 'model'>[];
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateProviderInput {
  provider: string;
  displayName: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiBaseUrl?: string | null;
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  maxConcurrentRequests?: number;
  priority?: number;
}

export interface UpdateProviderInput {
  displayName?: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiBaseUrl?: string | null;
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  maxConcurrentRequests?: number;
  priority?: number;
}

export interface CreateModelInput {
  modelId: string;
  displayName: string;
  isEnabled?: boolean;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  capabilities?: ModelCapability[];
}

export interface UpdateModelInput {
  displayName?: string;
  isEnabled?: boolean;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  capabilities?: ModelCapability[];
}

export interface CreateRoutingRuleInput {
  useCase: UseCaseType;
  tier?: number;
  modelConfigId: string;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface UpdateRoutingRuleInput {
  tier?: number;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface CreateCompanionOverrideInput {
  useCase: UseCaseType;
  tier?: number;
  modelConfigId: string;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number | null;
  timeoutMs?: number | null;
}

export interface UpdateCompanionOverrideInput {
  tier?: number;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number | null;
  timeoutMs?: number | null;
}

// ============================================================================
// Response Types
// ============================================================================

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface ListResponse<T> {
  success: boolean;
  data: {
    hasMore: boolean;
  } & T;
}

// ============================================================================
// Provider API
// ============================================================================

/**
 * List all providers with health status
 */
export async function listProviders(options?: {
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ providers: Provider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ providers: Provider[] }>>(
    '/admin/providers',
    options
  );
  return response.data;
}

/**
 * Get a provider by ID with all models
 */
export async function getProvider(id: string): Promise<ProviderWithModels> {
  const response = await get<ApiResponse<ProviderWithModels>>(`/admin/providers/${id}`);
  return response.data;
}

/**
 * Create a new provider
 */
export async function createProvider(input: CreateProviderInput): Promise<Provider> {
  const response = await post<ApiResponse<Provider>>('/admin/providers', input);
  return response.data;
}

/**
 * Update a provider
 */
export async function updateProvider(id: string, input: UpdateProviderInput): Promise<Provider> {
  const response = await patch<ApiResponse<Provider>>(`/admin/providers/${id}`, input);
  return response.data;
}

/**
 * Delete a provider
 */
export async function deleteProvider(id: string): Promise<void> {
  await del(`/admin/providers/${id}`);
}

/**
 * Test provider connection
 */
export async function testProviderConnection(id: string): Promise<ConnectionTestResult> {
  const response = await post<ApiResponse<ConnectionTestResult>>(`/admin/providers/${id}/test`);
  return response.data;
}

/**
 * Discovered model from provider API
 */
export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  capabilities?: string[];
}

/**
 * Discover available models from a provider's API
 */
export async function discoverProviderModels(id: string): Promise<{
  success: boolean;
  models: DiscoveredModel[];
  error?: string;
}> {
  const response = await get<ApiResponse<{
    success: boolean;
    models: DiscoveredModel[];
    error?: string;
  }>>(`/admin/providers/${id}/discover-models`);
  return response.data;
}

// ============================================================================
// Model API
// ============================================================================

/**
 * List all models
 */
export async function listModels(options?: {
  providerConfigId?: string;
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ models: ModelWithProvider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ models: ModelWithProvider[] }>>(
    '/admin/models',
    options
  );
  return response.data;
}

/**
 * List models for a specific provider
 */
export async function listProviderModels(
  providerId: string,
  options?: {
    isEnabled?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ models: ModelWithProvider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ models: ModelWithProvider[] }>>(
    `/admin/providers/${providerId}/models`,
    options
  );
  return response.data;
}

/**
 * Create a model for a provider
 */
export async function createModel(providerId: string, input: CreateModelInput): Promise<Model> {
  const response = await post<ApiResponse<Model>>(`/admin/providers/${providerId}/models`, input);
  return response.data;
}

/**
 * Update a model
 */
export async function updateModel(id: string, input: UpdateModelInput): Promise<Model> {
  const response = await patch<ApiResponse<Model>>(`/admin/models/${id}`, input);
  return response.data;
}

/**
 * Delete a model
 */
export async function deleteModel(id: string): Promise<void> {
  await del(`/admin/models/${id}`);
}

// ============================================================================
// Routing Rules API
// ============================================================================

/**
 * List all routing rules
 */
export async function listRoutingRules(options?: {
  useCase?: UseCaseType;
  tier?: number;
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rules: RoutingRule[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ rules: RoutingRule[] }>>(
    '/admin/routing/rules',
    options
  );
  return response.data;
}

/**
 * Get routing rules for a specific use case
 */
export async function getRoutingRulesForUseCase(useCase: UseCaseType): Promise<{
  useCase: UseCaseType;
  rules: Array<Omit<RoutingRule, 'useCase' | 'createdAt' | 'updatedAt'>>;
}> {
  const response = await get<ApiResponse<{
    useCase: UseCaseType;
    rules: Array<Omit<RoutingRule, 'useCase' | 'createdAt' | 'updatedAt'>>;
  }>>(`/admin/routing/use-cases/${useCase}`);
  return response.data;
}

/**
 * Create a routing rule
 */
export async function createRoutingRule(input: CreateRoutingRuleInput): Promise<RoutingRule> {
  const response = await post<ApiResponse<RoutingRule>>('/admin/routing/rules', input);
  return response.data;
}

/**
 * Update a routing rule
 */
export async function updateRoutingRule(id: string, input: UpdateRoutingRuleInput): Promise<RoutingRule> {
  const response = await patch<ApiResponse<RoutingRule>>(`/admin/routing/rules/${id}`, input);
  return response.data;
}

/**
 * Delete a routing rule
 */
export async function deleteRoutingRule(id: string): Promise<void> {
  await del(`/admin/routing/rules/${id}`);
}

// ============================================================================
// Effective Routing & Utilities
// ============================================================================

/**
 * Get effective routing for a companion and use case
 */
export async function getEffectiveRouting(
  useCase: UseCaseType,
  companionId?: string
): Promise<EffectiveRoutingConfig> {
  const response = await get<ApiResponse<EffectiveRoutingConfig>>(
    '/admin/routing/effective',
    { useCase, companionId }
  );
  return response.data;
}

/**
 * Validate current configuration
 */
export async function validateConfiguration(): Promise<ValidationResult> {
  const response = await post<ApiResponse<ValidationResult>>('/admin/routing/validate');
  return response.data;
}

/**
 * Sync configuration to orchestrator
 */
export async function syncWithOrchestrator(): Promise<SyncResult> {
  const response = await post<ApiResponse<SyncResult>>('/admin/routing/sync');
  return response.data;
}

/**
 * Export current configuration
 */
export async function exportConfiguration(): Promise<ConfigurationExport> {
  const response = await get<ApiResponse<ConfigurationExport>>('/admin/routing/export');
  return response.data;
}

// ============================================================================
// Companion Overrides API
// ============================================================================

/**
 * List companion routing overrides
 */
export async function listCompanionOverrides(
  companionId: string,
  useCase?: UseCaseType
): Promise<{ overrides: CompanionOverride[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ overrides: CompanionOverride[] }>>(
    `/admin/companions/${companionId}/routing`,
    useCase ? { useCase } : undefined
  );
  return response.data;
}

/**
 * Create a companion override
 */
export async function createCompanionOverride(
  companionId: string,
  input: CreateCompanionOverrideInput
): Promise<CompanionOverride> {
  const response = await post<ApiResponse<CompanionOverride>>(
    `/admin/companions/${companionId}/routing`,
    input
  );
  return response.data;
}

/**
 * Update a companion override
 */
export async function updateCompanionOverride(
  companionId: string,
  overrideId: string,
  input: UpdateCompanionOverrideInput
): Promise<CompanionOverride> {
  const response = await patch<ApiResponse<CompanionOverride>>(
    `/admin/companions/${companionId}/routing/${overrideId}`,
    input
  );
  return response.data;
}

/**
 * Delete a companion override
 */
export async function deleteCompanionOverride(companionId: string, overrideId: string): Promise<void> {
  await del(`/admin/companions/${companionId}/routing/${overrideId}`);
}

/**
 * Copy platform defaults to companion
 */
export async function copyPlatformDefaultsToCompanion(
  companionId: string,
  useCases?: UseCaseType[]
): Promise<{ copied: number; overrides: CompanionOverride[] }> {
  const response = await post<ApiResponse<{ copied: number; overrides: CompanionOverride[] }>>(
    `/admin/companions/${companionId}/routing/copy-defaults`,
    useCases ? { useCases } : undefined
  );
  return response.data;
}
