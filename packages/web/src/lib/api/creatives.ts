/**
 * Creative API Client
 * API operations for ad creative management.
 */

import { get, post, patch, del } from './client';

// ============================================================================
// Types
// ============================================================================

export type AdCreativeStatus =
  | 'draft'
  | 'generating_video'
  | 'generating_voiceover'
  | 'ready'
  | 'published'
  | 'failed';

export type CreativeAssetType = 'source_image' | 'video' | 'voiceover' | 'combined';

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface AdCreative {
  id: string;
  user_id: string | null;
  companion_id: string | null;
  name: string;
  description: string | null;
  status: AdCreativeStatus;
  // Video configuration
  video_model_id: string | null;
  source_image_url: string | null;
  video_prompt: string | null;
  video_duration_seconds: number;
  width: number;
  height: number;
  // Audio configuration
  script_text: string | null;
  voice_id: string | null;
  voice_settings: VoiceSettings | null;
  // Output URLs
  video_url: string | null;
  voiceover_url: string | null;
  final_video_url: string | null;
  thumbnail_url: string | null;
  file_size_bytes: number | null;
  // Publishing status
  published_platforms: {
    google?: { asset_id?: string; published_at?: string };
    facebook?: { creative_id?: string; published_at?: string };
  } | null;
  // Billing
  token_cost: number;
  is_admin_created: boolean;
  // Generation tracking
  generation_started_at: string | null;
  generation_completed_at: string | null;
  generation_error: string | null;
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface CreativeAsset {
  id: string;
  creative_id: string;
  asset_type: CreativeAssetType;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  url: string | null;
  duration_ms: number | null;
  file_size_bytes: number | null;
  format: string | null;
  generation_error: string | null;
}

export interface VideoModel {
  id: string;
  display_name: string;
  provider: string;
  max_duration_seconds: number;
  supported_resolutions: Array<{ width: number; height: number }>;
  cost_per_second_cents: number;
  capabilities: string[];
}

export interface CreateCreativeInput {
  name: string;
  description?: string;
  companionId?: string;
  videoModelId?: string;
  sourceImageUrl?: string;
  videoPrompt?: string;
  videoDurationSeconds?: number;
  width?: number;
  height?: number;
  scriptText?: string;
  voiceId?: string;
  voiceSettings?: VoiceSettings;
}

export interface UpdateCreativeInput extends Partial<CreateCreativeInput> {
  status?: AdCreativeStatus;
}

// ============================================================================
// API Functions
// ============================================================================

export async function listCreatives(params?: {
  limit?: number;
  offset?: number;
  status?: AdCreativeStatus;
  companionId?: string;
}): Promise<{ success: boolean; data?: { creatives: AdCreative[]; hasMore: boolean }; error?: string }> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.status) searchParams.set('status', params.status);
  if (params?.companionId) searchParams.set('companionId', params.companionId);

  const query = searchParams.toString();
  return get(`/admin/creatives${query ? `?${query}` : ''}`);
}

export async function getCreative(id: string): Promise<{
  success: boolean;
  data?: AdCreative & { assets: CreativeAsset[] };
  error?: string;
}> {
  return get(`/admin/creatives/${id}`);
}

export async function createCreative(
  data: CreateCreativeInput
): Promise<{ success: boolean; data?: AdCreative; error?: string }> {
  return post('/admin/creatives', data);
}

export async function updateCreative(
  id: string,
  data: UpdateCreativeInput
): Promise<{ success: boolean; data?: AdCreative; error?: string }> {
  return patch(`/admin/creatives/${id}`, data);
}

export async function deleteCreative(
  id: string
): Promise<{ success: boolean; error?: string }> {
  return del(`/admin/creatives/${id}`);
}

// Generation

export async function generateVideo(
  creativeId: string,
  params?: {
    videoModelId?: string;
    videoPrompt?: string;
    sourceImageUrl?: string;
    durationSeconds?: number;
  }
): Promise<{ success: boolean; data?: { jobId: string }; error?: string }> {
  return post(`/admin/creatives/${creativeId}/generate/video`, params ?? {});
}

export async function generateVoiceover(
  creativeId: string,
  params?: {
    voiceId?: string;
    scriptText?: string;
  }
): Promise<{ success: boolean; data?: { jobId: string }; error?: string }> {
  return post(`/admin/creatives/${creativeId}/generate/voiceover`, params ?? {});
}

export async function getGenerationStatus(creativeId: string): Promise<{
  success: boolean;
  data?: {
    status: AdCreativeStatus;
    generationStartedAt: string | null;
    generationCompletedAt: string | null;
    generationError: string | null;
    videoUrl: string | null;
    voiceoverUrl: string | null;
    finalVideoUrl: string | null;
    assets: Array<{
      id: string;
      type: CreativeAssetType;
      status: string;
      url: string | null;
      error: string | null;
    }>;
  };
  error?: string;
}> {
  return get(`/admin/creatives/${creativeId}/status`);
}

export async function uploadCombinedVideo(
  creativeId: string,
  data: {
    finalVideoUrl: string;
    finalVideoS3Key: string;
    fileSizeBytes: number;
    durationMs: number;
  }
): Promise<{ success: boolean; data?: AdCreative; error?: string }> {
  return post(`/admin/creatives/${creativeId}/upload-combined`, data);
}

// Publishing

export async function publishToGoogle(
  creativeId: string,
  params?: { campaignId?: string }
): Promise<{ success: boolean; data?: { message: string }; error?: string }> {
  return post(`/admin/creatives/${creativeId}/publish/google`, params ?? {});
}

export async function publishToFacebook(
  creativeId: string,
  params?: { adSetId?: string }
): Promise<{ success: boolean; data?: { message: string }; error?: string }> {
  return post(`/admin/creatives/${creativeId}/publish/facebook`, params ?? {});
}

// Video Models

export async function listVideoModels(): Promise<{
  success: boolean;
  data?: { models: VideoModel[]; defaultModel: string };
  error?: string;
}> {
  return get('/admin/creatives/video-models');
}
