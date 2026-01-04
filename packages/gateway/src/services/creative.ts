/**
 * Creative Service
 * Business logic for ad creative generation and management.
 */

import { z } from 'zod';
import {
  getCreativeRepository,
  type CreativeListFilters,
} from '../repositories/creative.js';
import { logger } from '../observability/logger.js';
import type {
  AdCreative,
  AdCreativeInsert,
  AdCreativeUpdate,
  CreativeAsset,
  CreativeAssetInsert,
  VoiceSettings,
  VideoModelInfo,
  UUID,
} from '../db/types.js';
import type { PaginatedResult, TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const CreateCreativeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  companionId: z.string().uuid().optional(),
  // Video configuration
  videoModelId: z.string().optional(),
  sourceImageUrl: z.string().url().optional(),
  sourceImageS3Key: z.string().optional(),
  videoPrompt: z.string().min(1).max(2000).optional(),
  videoDurationSeconds: z.number().int().min(1).max(30).default(5),
  width: z.number().int().min(480).max(1920).default(1080),
  height: z.number().int().min(480).max(1920).default(1920),
  // Audio configuration
  scriptText: z.string().max(5000).optional(),
  voiceId: z.string().optional(),
  voiceSettings: z
    .object({
      stability: z.number().min(0).max(1).optional(),
      similarity_boost: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      use_speaker_boost: z.boolean().optional(),
    })
    .optional(),
});

export const UpdateCreativeSchema = CreateCreativeSchema.partial().extend({
  status: z
    .enum(['draft', 'generating_video', 'generating_voiceover', 'ready', 'published', 'failed'])
    .optional(),
});

export type CreateCreativeInput = z.infer<typeof CreateCreativeSchema>;
export type UpdateCreativeInput = z.infer<typeof UpdateCreativeSchema>;

// ============================================================================
// Video Model Definitions
// ============================================================================

const VIDEO_MODELS: VideoModelInfo[] = [
  {
    id: 'fal/kling-1.6-pro',
    display_name: 'Kling 1.6 Pro',
    provider: 'fal',
    max_duration_seconds: 10,
    supported_resolutions: [
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
      { width: 720, height: 1280 },
    ],
    cost_per_second_cents: 10,
    capabilities: ['image_to_video'],
  },
  {
    id: 'fal/kling-1.6-standard',
    display_name: 'Kling 1.6 Standard',
    provider: 'fal',
    max_duration_seconds: 5,
    supported_resolutions: [
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
    ],
    cost_per_second_cents: 5,
    capabilities: ['image_to_video'],
  },
  {
    id: 'fal/runway-gen3-turbo',
    display_name: 'Runway Gen-3 Turbo',
    provider: 'fal',
    max_duration_seconds: 10,
    supported_resolutions: [
      { width: 1280, height: 768 },
      { width: 768, height: 1280 },
    ],
    cost_per_second_cents: 8,
    capabilities: ['image_to_video', 'text_to_video'],
  },
  {
    id: 'fal/minimax-video-01',
    display_name: 'MiniMax Video-01',
    provider: 'fal',
    max_duration_seconds: 6,
    supported_resolutions: [
      { width: 1280, height: 720 },
      { width: 720, height: 1280 },
    ],
    cost_per_second_cents: 6,
    capabilities: ['image_to_video', 'text_to_video'],
  },
  {
    id: 'fal/luma-dream-machine',
    display_name: 'Luma Dream Machine',
    provider: 'fal',
    max_duration_seconds: 5,
    supported_resolutions: [
      { width: 1360, height: 752 },
      { width: 752, height: 1360 },
    ],
    cost_per_second_cents: 7,
    capabilities: ['image_to_video', 'text_to_video'],
  },
  {
    id: 'fal/hunyuan-video',
    display_name: 'Hunyuan Video',
    provider: 'fal',
    max_duration_seconds: 5,
    supported_resolutions: [
      { width: 1280, height: 720 },
      { width: 720, height: 1280 },
    ],
    cost_per_second_cents: 4,
    capabilities: ['text_to_video'],
  },
];

// ============================================================================
// Service
// ============================================================================

export class CreativeService {
  private repository = getCreativeRepository();

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  async createCreative(
    input: CreateCreativeInput,
    userId: UUID | null,
    isAdmin: boolean,
    tx?: TransactionContext
  ): Promise<AdCreative> {
    const validated = CreateCreativeSchema.parse(input);

    const insert: AdCreativeInsert = {
      user_id: userId,
      companion_id: validated.companionId,
      name: validated.name,
      description: validated.description,
      video_model_id: validated.videoModelId,
      source_image_url: validated.sourceImageUrl,
      source_image_s3_key: validated.sourceImageS3Key,
      video_prompt: validated.videoPrompt,
      video_duration_seconds: validated.videoDurationSeconds,
      width: validated.width,
      height: validated.height,
      script_text: validated.scriptText,
      voice_id: validated.voiceId,
      voice_settings: validated.voiceSettings as VoiceSettings,
      is_admin_created: isAdmin,
    };

    const creative = await this.repository.createCreative(insert, tx);

    logger.info(
      { creativeId: creative.id, userId, isAdmin },
      'Creative created'
    );

    return creative;
  }

  async getCreative(id: UUID, tx?: TransactionContext): Promise<AdCreative | null> {
    return this.repository.getCreativeById(id, tx);
  }

  async updateCreative(
    id: UUID,
    input: UpdateCreativeInput,
    tx?: TransactionContext
  ): Promise<AdCreative> {
    const validated = UpdateCreativeSchema.parse(input);

    const update: AdCreativeUpdate = {};

    if (validated.name !== undefined) update.name = validated.name;
    if (validated.description !== undefined) update.description = validated.description;
    if (validated.status !== undefined) update.status = validated.status;
    if (validated.videoModelId !== undefined) update.video_model_id = validated.videoModelId;
    if (validated.sourceImageUrl !== undefined) update.source_image_url = validated.sourceImageUrl;
    if (validated.sourceImageS3Key !== undefined) update.source_image_s3_key = validated.sourceImageS3Key;
    if (validated.videoPrompt !== undefined) update.video_prompt = validated.videoPrompt;
    if (validated.videoDurationSeconds !== undefined) update.video_duration_seconds = validated.videoDurationSeconds;
    if (validated.width !== undefined) update.width = validated.width;
    if (validated.height !== undefined) update.height = validated.height;
    if (validated.scriptText !== undefined) update.script_text = validated.scriptText;
    if (validated.voiceId !== undefined) update.voice_id = validated.voiceId;
    if (validated.voiceSettings !== undefined) update.voice_settings = validated.voiceSettings as VoiceSettings;

    return this.repository.updateCreative(id, update, tx);
  }

  async deleteCreative(id: UUID, tx?: TransactionContext): Promise<void> {
    await this.repository.deleteCreative(id, tx);
    logger.info({ creativeId: id }, 'Creative deleted');
  }

  async listCreatives(
    filters: CreativeListFilters = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<AdCreative>> {
    return this.repository.listCreatives(filters, tx);
  }

  // ===========================================================================
  // Asset Operations
  // ===========================================================================

  async createAsset(
    insert: CreativeAssetInsert,
    tx?: TransactionContext
  ): Promise<CreativeAsset> {
    return this.repository.createAsset(insert, tx);
  }

  async getAssetsByCreativeId(
    creativeId: UUID,
    tx?: TransactionContext
  ): Promise<CreativeAsset[]> {
    return this.repository.listAssetsByCreativeId(creativeId, {}, tx);
  }

  // ===========================================================================
  // Video Generation
  // ===========================================================================

  async startVideoGeneration(
    creativeId: UUID,
    tx?: TransactionContext
  ): Promise<{ jobId: string }> {
    const creative = await this.repository.getCreativeById(creativeId, tx);
    if (!creative) {
      throw new Error(`Creative not found: ${creativeId}`);
    }

    if (!creative.video_prompt) {
      throw new Error('Video prompt is required for video generation');
    }

    if (!creative.video_model_id) {
      throw new Error('Video model is required for video generation');
    }

    // Update status
    await this.repository.updateCreative(
      creativeId,
      {
        status: 'generating_video',
        generation_started_at: new Date(),
        generation_error: null,
      },
      tx
    );

    // Create asset record for the video
    const asset = await this.repository.createAsset(
      {
        creative_id: creativeId,
        asset_type: 'video',
        status: 'generating',
        generation_params: {
          model_id: creative.video_model_id,
          prompt: creative.video_prompt,
          duration_seconds: creative.video_duration_seconds,
        },
      },
      tx
    );

    logger.info(
      { creativeId, assetId: asset.id, modelId: creative.video_model_id },
      'Video generation started'
    );

    // Return the asset ID as the job ID for tracking
    return { jobId: asset.id };
  }

  async completeVideoGeneration(
    creativeId: UUID,
    result: {
      videoUrl: string;
      videoS3Key: string;
      thumbnailUrl?: string;
      thumbnailS3Key?: string;
      durationMs: number;
      fileSizeBytes?: number;
    },
    tx?: TransactionContext
  ): Promise<AdCreative> {
    // Update the creative with video results
    const creative = await this.repository.updateCreative(
      creativeId,
      {
        status: 'ready',
        video_url: result.videoUrl,
        video_s3_key: result.videoS3Key,
        thumbnail_url: result.thumbnailUrl,
        thumbnail_s3_key: result.thumbnailS3Key,
        file_size_bytes: result.fileSizeBytes,
        generation_completed_at: new Date(),
      },
      tx
    );

    logger.info({ creativeId }, 'Video generation completed');

    return creative;
  }

  async failVideoGeneration(
    creativeId: UUID,
    error: string,
    tx?: TransactionContext
  ): Promise<AdCreative> {
    const creative = await this.repository.updateCreative(
      creativeId,
      {
        status: 'failed',
        generation_error: error,
        generation_completed_at: new Date(),
      },
      tx
    );

    logger.error({ creativeId, error }, 'Video generation failed');

    return creative;
  }

  // ===========================================================================
  // Voiceover Generation
  // ===========================================================================

  async startVoiceoverGeneration(
    creativeId: UUID,
    tx?: TransactionContext
  ): Promise<{ jobId: string }> {
    const creative = await this.repository.getCreativeById(creativeId, tx);
    if (!creative) {
      throw new Error(`Creative not found: ${creativeId}`);
    }

    if (!creative.script_text) {
      throw new Error('Script text is required for voiceover generation');
    }

    if (!creative.voice_id) {
      throw new Error('Voice ID is required for voiceover generation');
    }

    // Update status
    await this.repository.updateCreative(
      creativeId,
      {
        status: 'generating_voiceover',
        generation_started_at: new Date(),
        generation_error: null,
      },
      tx
    );

    // Create asset record for the voiceover
    const asset = await this.repository.createAsset(
      {
        creative_id: creativeId,
        asset_type: 'voiceover',
        status: 'generating',
        generation_params: {
          voice_id: creative.voice_id,
          voice_settings: creative.voice_settings,
        },
      },
      tx
    );

    logger.info(
      { creativeId, assetId: asset.id, voiceId: creative.voice_id },
      'Voiceover generation started'
    );

    return { jobId: asset.id };
  }

  async completeVoiceoverGeneration(
    creativeId: UUID,
    result: {
      voiceoverUrl: string;
      voiceoverS3Key: string;
      durationMs: number;
      fileSizeBytes?: number;
    },
    tx?: TransactionContext
  ): Promise<AdCreative> {
    const creative = await this.repository.updateCreative(
      creativeId,
      {
        voiceover_url: result.voiceoverUrl,
        voiceover_s3_key: result.voiceoverS3Key,
        generation_completed_at: new Date(),
      },
      tx
    );

    logger.info({ creativeId }, 'Voiceover generation completed');

    return creative;
  }

  // ===========================================================================
  // Combined Video Upload
  // ===========================================================================

  async uploadCombinedVideo(
    creativeId: UUID,
    result: {
      finalVideoUrl: string;
      finalVideoS3Key: string;
      fileSizeBytes: number;
      durationMs: number;
    },
    tx?: TransactionContext
  ): Promise<AdCreative> {
    // Create asset record for the combined video
    await this.repository.createAsset(
      {
        creative_id: creativeId,
        asset_type: 'combined',
        status: 'ready',
        s3_key: result.finalVideoS3Key,
        url: result.finalVideoUrl,
        file_size_bytes: result.fileSizeBytes,
        duration_ms: result.durationMs,
        format: 'webm',
      },
      tx
    );

    // Update creative with final video
    const creative = await this.repository.updateCreative(
      creativeId,
      {
        status: 'ready',
        final_video_url: result.finalVideoUrl,
        final_video_s3_key: result.finalVideoS3Key,
        file_size_bytes: result.fileSizeBytes,
      },
      tx
    );

    logger.info({ creativeId }, 'Combined video uploaded');

    return creative;
  }

  // ===========================================================================
  // Billing
  // ===========================================================================

  calculateTokenCost(
    durationSeconds: number,
    modelId: string,
    hasVoiceover: boolean,
    isAdmin: boolean
  ): number {
    if (isAdmin) return 0;

    const model = VIDEO_MODELS.find((m) => m.id === modelId);
    const costPerSecond = model?.cost_per_second_cents ?? 5;

    const videoCost = durationSeconds * costPerSecond;
    const voiceoverCost = hasVoiceover ? Math.ceil(durationSeconds * 2) : 0;

    return videoCost + voiceoverCost;
  }

  // ===========================================================================
  // Video Models
  // ===========================================================================

  getVideoModels(): VideoModelInfo[] {
    return VIDEO_MODELS;
  }

  getVideoModel(modelId: string): VideoModelInfo | undefined {
    return VIDEO_MODELS.find((m) => m.id === modelId);
  }
}

// Singleton instance
let creativeService: CreativeService | null = null;

export function getCreativeService(): CreativeService {
  if (!creativeService) {
    creativeService = new CreativeService();
  }
  return creativeService;
}
