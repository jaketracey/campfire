/**
 * Image Provider Settings API
 * Administrative operations for image provider configurations and routing.
 */

import { get, post, patch, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type ImageUseCaseType =
  | 'image_generation'
  | 'image_anchor'
  | 'image_variation';

export const IMAGE_USE_CASE_TYPES: ImageUseCaseType[] = [
  'image_generation',
  'image_anchor',
  'image_variation',
];

export const IMAGE_USE_CASE_LABELS: Record<ImageUseCaseType, string> = {
  image_generation: 'Image Generation',
  image_anchor: 'Identity Anchors',
  image_variation: 'Image Variations',
};

export const IMAGE_USE_CASE_DESCRIPTIONS: Record<ImageUseCaseType, string> = {
  image_generation: 'Standard image generation for chat messages',
  image_anchor: 'High-quality identity anchor images',
  image_variation: 'Creating image variations from reference images',
};

export type ImageModelCapability = 'nsfw' | 'ip_adapter' | 'inpainting' | 'controlnet';

export const IMAGE_CAPABILITY_LABELS: Record<ImageModelCapability, string> = {
  nsfw: 'NSFW',
  ip_adapter: 'IP-Adapter',
  inpainting: 'Inpainting',
  controlnet: 'ControlNet',
};

export interface ImageProviderHealth {
  isAvailable: boolean;
  lastCheckAt: string | null;
  avgLatencyMs: number | null;
  successRate: number | null;
  errorCount: number;
}

export interface ImageProvider {
  id: string;
  provider: string;
  displayName: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  apiBaseUrl: string | null;
  rateLimitRpm: number | null;
  maxConcurrentRequests: number;
  priority: number;
  modelCount: number;
  health: ImageProviderHealth | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageProviderWithModels extends Omit<ImageProvider, 'modelCount' | 'health'> {
  metadata: Record<string, unknown>;
  models: ImageModel[];
}

export interface ImageModel {
  id: string;
  providerConfigId: string;
  modelId: string;
  displayName: string;
  isEnabled: boolean;
  maxResolution: [number, number] | null;
  costPerImage: number | null;
  avgGenerationTime: number | null;
  capabilities: ImageModelCapability[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ImageModelWithProvider extends ImageModel {
  provider: string;
  providerDisplayName: string;
  providerIsEnabled: boolean;
}

export interface ImageRoutingRule {
  id: string;
  useCase: ImageUseCaseType;
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
    capabilities: ImageModelCapability[];
    provider: string;
    providerDisplayName: string;
    providerIsEnabled: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageConnectionTestResult {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface ImageSyncResult {
  success: boolean;
  synced: {
    providers: number;
    models: number;
    rules: number;
  };
  error: string | null;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateImageProviderInput {
  provider: string;
  displayName: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiBaseUrl?: string | null;
  rateLimitRpm?: number | null;
  maxConcurrentRequests?: number;
  priority?: number;
}

export interface UpdateImageProviderInput {
  displayName?: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiBaseUrl?: string | null;
  rateLimitRpm?: number | null;
  maxConcurrentRequests?: number;
  priority?: number;
}

export interface CreateImageModelInput {
  modelId: string;
  displayName: string;
  isEnabled?: boolean;
  maxResolution?: [number, number] | null;
  costPerImage?: number | null;
  avgGenerationTime?: number | null;
  capabilities?: ImageModelCapability[];
}

export interface UpdateImageModelInput {
  displayName?: string;
  isEnabled?: boolean;
  maxResolution?: [number, number] | null;
  costPerImage?: number | null;
  avgGenerationTime?: number | null;
  capabilities?: ImageModelCapability[];
}

export interface CreateImageRoutingRuleInput {
  useCase: ImageUseCaseType;
  tier?: number;
  modelConfigId: string;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface UpdateImageRoutingRuleInput {
  tier?: number;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
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
 * List all image providers with health status
 */
export async function listImageProviders(options?: {
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ providers: ImageProvider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ providers: ImageProvider[] }>>(
    '/admin/image-providers',
    options
  );
  return response.data;
}

/**
 * Get an image provider by ID with all models
 */
export async function getImageProvider(id: string): Promise<ImageProviderWithModels> {
  const response = await get<ApiResponse<ImageProviderWithModels>>(`/admin/image-providers/${id}`);
  return response.data;
}

/**
 * Create a new image provider
 */
export async function createImageProvider(input: CreateImageProviderInput): Promise<ImageProvider> {
  const response = await post<ApiResponse<ImageProvider>>('/admin/image-providers', input);
  return response.data;
}

/**
 * Update an image provider
 */
export async function updateImageProvider(id: string, input: UpdateImageProviderInput): Promise<ImageProvider> {
  const response = await patch<ApiResponse<ImageProvider>>(`/admin/image-providers/${id}`, input);
  return response.data;
}

/**
 * Delete an image provider
 */
export async function deleteImageProvider(id: string): Promise<void> {
  await del(`/admin/image-providers/${id}`);
}

/**
 * Test image provider connection
 */
export async function testImageProviderConnection(id: string): Promise<ImageConnectionTestResult> {
  const response = await post<ApiResponse<ImageConnectionTestResult>>(`/admin/image-providers/${id}/test`);
  return response.data;
}

// ============================================================================
// Model API
// ============================================================================

/**
 * List all image models
 */
export async function listImageModels(options?: {
  providerConfigId?: string;
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ models: ImageModelWithProvider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ models: ImageModelWithProvider[] }>>(
    '/admin/image-models',
    options
  );
  return response.data;
}

/**
 * Create an image model for a provider
 */
export async function createImageModel(providerId: string, input: CreateImageModelInput): Promise<ImageModel> {
  const response = await post<ApiResponse<ImageModel>>(`/admin/image-providers/${providerId}/models`, input);
  return response.data;
}

/**
 * Update an image model
 */
export async function updateImageModel(id: string, input: UpdateImageModelInput): Promise<ImageModel> {
  const response = await patch<ApiResponse<ImageModel>>(`/admin/image-models/${id}`, input);
  return response.data;
}

/**
 * Delete an image model
 */
export async function deleteImageModel(id: string): Promise<void> {
  await del(`/admin/image-models/${id}`);
}

// ============================================================================
// Routing Rules API
// ============================================================================

/**
 * List all image routing rules
 */
export async function listImageRoutingRules(options?: {
  useCase?: ImageUseCaseType;
  tier?: number;
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rules: ImageRoutingRule[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ rules: ImageRoutingRule[] }>>(
    '/admin/image-routing/rules',
    options
  );
  return response.data;
}

/**
 * Get routing rules for a specific use case
 */
export async function getImageRoutingForUseCase(useCase: ImageUseCaseType): Promise<{
  useCase: ImageUseCaseType;
  rules: Array<Omit<ImageRoutingRule, 'useCase' | 'createdAt' | 'updatedAt'>>;
}> {
  const response = await get<ApiResponse<{
    useCase: ImageUseCaseType;
    rules: Array<Omit<ImageRoutingRule, 'useCase' | 'createdAt' | 'updatedAt'>>;
  }>>(`/admin/image-routing/use-cases/${useCase}`);
  return response.data;
}

/**
 * Create an image routing rule
 */
export async function createImageRoutingRule(input: CreateImageRoutingRuleInput): Promise<ImageRoutingRule> {
  const response = await post<ApiResponse<ImageRoutingRule>>('/admin/image-routing/rules', input);
  return response.data;
}

/**
 * Update an image routing rule
 */
export async function updateImageRoutingRule(id: string, input: UpdateImageRoutingRuleInput): Promise<ImageRoutingRule> {
  const response = await patch<ApiResponse<ImageRoutingRule>>(`/admin/image-routing/rules/${id}`, input);
  return response.data;
}

/**
 * Delete an image routing rule
 */
export async function deleteImageRoutingRule(id: string): Promise<void> {
  await del(`/admin/image-routing/rules/${id}`);
}

// ============================================================================
// Sync & Utilities
// ============================================================================

/**
 * Sync image configuration to orchestrator
 */
export async function syncImageConfig(): Promise<ImageSyncResult> {
  const response = await post<ApiResponse<ImageSyncResult>>('/admin/image-routing/sync');
  return response.data;
}
