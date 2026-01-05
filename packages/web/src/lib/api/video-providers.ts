/**
 * Video Provider Settings API
 * Administrative operations for video provider configurations and routing.
 */

import { get, post, patch, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type VideoUseCaseType =
  | 'video_generation'
  | 'video_from_image'
  | 'video_lip_sync'
  | 'video_motion_brush';

export const VIDEO_USE_CASE_TYPES: VideoUseCaseType[] = [
  'video_generation',
  'video_from_image',
  'video_lip_sync',
  'video_motion_brush',
];

export const VIDEO_USE_CASE_LABELS: Record<VideoUseCaseType, string> = {
  video_generation: 'Video Generation',
  video_from_image: 'Image-to-Video',
  video_lip_sync: 'Lip Sync Video',
  video_motion_brush: 'Motion Brush',
};

export const VIDEO_USE_CASE_DESCRIPTIONS: Record<VideoUseCaseType, string> = {
  video_generation: 'Generate video from text prompts',
  video_from_image: 'Animate a static image into video',
  video_lip_sync: 'Generate video with lip sync support',
  video_motion_brush: 'Generate video with motion brush controls',
};

export type VideoModelCapability = 'image_to_video' | 'lip_sync' | 'motion_brush' | 'camera_control';

export const VIDEO_CAPABILITY_LABELS: Record<VideoModelCapability, string> = {
  image_to_video: 'Image-to-Video',
  lip_sync: 'Lip Sync',
  motion_brush: 'Motion Brush',
  camera_control: 'Camera Control',
};

export interface VideoProviderHealth {
  isAvailable: boolean;
  lastCheckAt: string | null;
  avgLatencyMs: number | null;
  successRate: number | null;
  errorCount: number;
}

export interface VideoProvider {
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
  health: VideoProviderHealth | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoProviderWithModels extends Omit<VideoProvider, 'modelCount' | 'health'> {
  metadata: Record<string, unknown>;
  models: VideoModel[];
}

export interface VideoModel {
  id: string;
  providerConfigId: string;
  modelId: string;
  displayName: string;
  isEnabled: boolean;
  maxDurationSeconds: number | null;
  costPerSecond: number | null;
  capabilities: VideoModelCapability[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VideoModelWithProvider extends VideoModel {
  provider: string;
  providerDisplayName: string;
  providerIsEnabled: boolean;
}

export interface VideoRoutingRule {
  id: string;
  useCase: VideoUseCaseType;
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
    capabilities: VideoModelCapability[];
    provider: string;
    providerDisplayName: string;
    providerIsEnabled: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoConnectionTestResult {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface VideoSyncResult {
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

export interface CreateVideoProviderInput {
  provider: string;
  displayName: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiBaseUrl?: string | null;
  rateLimitRpm?: number | null;
  maxConcurrentRequests?: number;
  priority?: number;
}

export interface UpdateVideoProviderInput {
  displayName?: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiBaseUrl?: string | null;
  rateLimitRpm?: number | null;
  maxConcurrentRequests?: number;
  priority?: number;
}

export interface CreateVideoModelInput {
  modelId: string;
  displayName: string;
  isEnabled?: boolean;
  maxDurationSeconds?: number | null;
  costPerSecond?: number | null;
  capabilities?: VideoModelCapability[];
  metadata?: Record<string, unknown>;
}

export interface UpdateVideoModelInput {
  displayName?: string;
  isEnabled?: boolean;
  maxDurationSeconds?: number | null;
  costPerSecond?: number | null;
  capabilities?: VideoModelCapability[];
}

export interface CreateVideoRoutingRuleInput {
  useCase: VideoUseCaseType;
  tier?: number;
  modelConfigId: string;
  weight?: number;
  isEnabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface UpdateVideoRoutingRuleInput {
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
 * List all video providers with health status
 */
export async function listVideoProviders(options?: {
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ providers: VideoProvider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ providers: VideoProvider[] }>>(
    '/admin/video-providers',
    options
  );
  return response.data;
}

/**
 * Get a video provider by ID with all models
 */
export async function getVideoProvider(id: string): Promise<VideoProviderWithModels> {
  const response = await get<ApiResponse<VideoProviderWithModels>>(`/admin/video-providers/${id}`);
  return response.data;
}

/**
 * Create a new video provider
 */
export async function createVideoProvider(input: CreateVideoProviderInput): Promise<VideoProvider> {
  const response = await post<ApiResponse<VideoProvider>>('/admin/video-providers', input);
  return response.data;
}

/**
 * Update a video provider
 */
export async function updateVideoProvider(id: string, input: UpdateVideoProviderInput): Promise<VideoProvider> {
  const response = await patch<ApiResponse<VideoProvider>>(`/admin/video-providers/${id}`, input);
  return response.data;
}

/**
 * Delete a video provider
 */
export async function deleteVideoProvider(id: string): Promise<void> {
  await del(`/admin/video-providers/${id}`);
}

/**
 * Test video provider connection
 */
export async function testVideoProviderConnection(id: string): Promise<VideoConnectionTestResult> {
  const response = await post<ApiResponse<VideoConnectionTestResult>>(`/admin/video-providers/${id}/test`);
  return response.data;
}

// ============================================================================
// Model API
// ============================================================================

/**
 * List all video models
 */
export async function listVideoModels(options?: {
  providerConfigId?: string;
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ models: VideoModelWithProvider[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ models: VideoModelWithProvider[] }>>(
    '/admin/video-models',
    options
  );
  return response.data;
}

/**
 * Create a video model for a provider
 */
export async function createVideoModel(providerId: string, input: CreateVideoModelInput): Promise<VideoModel> {
  const response = await post<ApiResponse<VideoModel>>(`/admin/video-providers/${providerId}/models`, input);
  return response.data;
}

/**
 * Update a video model
 */
export async function updateVideoModel(id: string, input: UpdateVideoModelInput): Promise<VideoModel> {
  const response = await patch<ApiResponse<VideoModel>>(`/admin/video-models/${id}`, input);
  return response.data;
}

/**
 * Delete a video model
 */
export async function deleteVideoModel(id: string): Promise<void> {
  await del(`/admin/video-models/${id}`);
}

// ============================================================================
// Routing Rules API
// ============================================================================

/**
 * List all video routing rules
 */
export async function listVideoRoutingRules(options?: {
  useCase?: VideoUseCaseType;
  tier?: number;
  isEnabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rules: VideoRoutingRule[]; hasMore: boolean }> {
  const response = await get<ListResponse<{ rules: VideoRoutingRule[] }>>(
    '/admin/video-routing/rules',
    options
  );
  return response.data;
}

/**
 * Get routing rules for a specific use case
 */
export async function getVideoRoutingForUseCase(useCase: VideoUseCaseType): Promise<{
  useCase: VideoUseCaseType;
  rules: Array<Omit<VideoRoutingRule, 'useCase' | 'createdAt' | 'updatedAt'>>;
}> {
  const response = await get<ApiResponse<{
    useCase: VideoUseCaseType;
    rules: Array<Omit<VideoRoutingRule, 'useCase' | 'createdAt' | 'updatedAt'>>;
  }>>(`/admin/video-routing/use-cases/${useCase}`);
  return response.data;
}

/**
 * Create a video routing rule
 */
export async function createVideoRoutingRule(input: CreateVideoRoutingRuleInput): Promise<VideoRoutingRule> {
  const response = await post<ApiResponse<VideoRoutingRule>>('/admin/video-routing/rules', input);
  return response.data;
}

/**
 * Update a video routing rule
 */
export async function updateVideoRoutingRule(id: string, input: UpdateVideoRoutingRuleInput): Promise<VideoRoutingRule> {
  const response = await patch<ApiResponse<VideoRoutingRule>>(`/admin/video-routing/rules/${id}`, input);
  return response.data;
}

/**
 * Delete a video routing rule
 */
export async function deleteVideoRoutingRule(id: string): Promise<void> {
  await del(`/admin/video-routing/rules/${id}`);
}

// ============================================================================
// Sync & Utilities
// ============================================================================

/**
 * Sync video configuration to orchestrator
 */
export async function syncVideoConfig(): Promise<VideoSyncResult> {
  const response = await post<ApiResponse<VideoSyncResult>>('/admin/video-routing/sync');
  return response.data;
}
