/**
 * Influencer Models Service
 * Business logic for LoRA training with FAL.ai
 */

import { z } from 'zod';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import archiver from 'archiver';
import { Readable } from 'stream';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import {
  getInfluencerModelsRepository,
  type InfluencerModel,
  type InfluencerModelStatus,
  type InfluencerModelListFilters,
  type InfluencerModelSample,
  type InfluencerModelSampleInsert,
} from '../repositories/influencer-models.js';
import type { TransactionContext, PaginatedResult } from '../repositories/types.js';

// =========================================================================
// Validation Schemas
// =========================================================================

export const CreateModelSchema = z.object({
  name: z.string().min(1).max(255),
  trigger_word: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, {
    message: 'Trigger word must be lowercase alphanumeric with underscores only',
  }),
  training_steps: z.number().int().min(100).max(5000).default(1000),
  is_style: z.boolean().default(false),
});

export type CreateModelInput = z.infer<typeof CreateModelSchema>;

export const UpdateModelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  trigger_word: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/).optional(),
  training_steps: z.number().int().min(100).max(5000).optional(),
  is_style: z.boolean().optional(),
});

export type UpdateModelInput = z.infer<typeof UpdateModelSchema>;

export const GenerateSampleSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negative_prompt: z.string().max(1000).optional(),
  guidance_scale: z.number().min(1).max(20).default(7.5),
  lora_scale: z.number().min(0).max(1.5).default(1.0),
  num_inference_steps: z.number().int().min(10).max(50).default(28),
  seed: z.number().int().optional(),
  width: z.number().int().min(256).max(1536).default(768),
  height: z.number().int().min(256).max(1536).default(1024),
});

export type GenerateSampleInput = z.infer<typeof GenerateSampleSchema>;

// =========================================================================
// Constants
// =========================================================================

const S3_MEDIA_BUCKET = env.S3_MEDIA_BUCKET;
const S3_REGION = env.AWS_REGION;
const FAL_API_KEY = env.FAL_API_KEY;

const FAL_API_BASE = 'https://queue.fal.run';
const FAL_MODEL = 'fal-ai/flux-lora-fast-training';
const FAL_INFERENCE_MODEL = 'fal-ai/flux-lora';

const MIN_TRAINING_IMAGES = 15;
const MAX_TRAINING_IMAGES = 25;

// =========================================================================
// FAL.ai Types
// =========================================================================

interface FalSubmitResponse {
  request_id: string;
}

interface FalStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  error?: string;
  response_url?: string;
}

interface FalResultResponse {
  diffusers_lora_file: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  };
  config_file?: {
    url: string;
  };
}

interface FalInferenceResponse {
  images: Array<{
    url: string;
    width: number;
    height: number;
    content_type: string;
  }>;
  seed: number;
  has_nsfw_concepts: boolean[];
  prompt: string;
}

// =========================================================================
// Service Class
// =========================================================================

export class InfluencerModelsService {
  private repo = getInfluencerModelsRepository();
  private s3Client = new S3Client({ region: S3_REGION });

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  /**
   * Create a new influencer model
   */
  async create(input: CreateModelInput, tx?: TransactionContext): Promise<InfluencerModel> {
    const validated = CreateModelSchema.parse(input);
    const model = await this.repo.create(validated, tx);
    logger.info({ modelId: model.id, name: model.name }, 'Influencer model created');
    return model;
  }

  /**
   * Get a model by ID
   */
  async getById(id: string, tx?: TransactionContext): Promise<InfluencerModel | null> {
    return this.repo.findById(id, tx);
  }

  /**
   * Update a model
   */
  async update(id: string, input: UpdateModelInput, tx?: TransactionContext): Promise<InfluencerModel> {
    const validated = UpdateModelSchema.parse(input);
    const model = await this.repo.update(id, validated, tx);
    logger.info({ modelId: id }, 'Influencer model updated');
    return model;
  }

  /**
   * Delete a model and its S3 resources
   */
  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const model = await this.repo.findById(id, tx);
    if (!model) {
      throw new Error('Model not found');
    }

    // Delete S3 resources
    const keysToDelete = [
      ...model.training_images_s3_keys,
      model.training_zip_s3_key,
      model.lora_s3_key,
    ].filter(Boolean) as string[];

    await Promise.all(
      keysToDelete.map((key) =>
        this.s3Client
          .send(new DeleteObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: key }))
          .catch((err) => logger.warn({ key, error: err }, 'Failed to delete S3 object'))
      )
    );

    await this.repo.delete(id, tx);
    logger.info({ modelId: id }, 'Influencer model deleted');
  }

  /**
   * List models with filters
   */
  async list(filters: InfluencerModelListFilters, tx?: TransactionContext): Promise<PaginatedResult<InfluencerModel>> {
    return this.repo.list(filters, tx);
  }

  /**
   * Get model stats
   */
  async getStats(tx?: TransactionContext) {
    return this.repo.getStats(tx);
  }

  // =========================================================================
  // Image Upload
  // =========================================================================

  /**
   * Generate a presigned URL for uploading a training image
   */
  async getPresignedUploadUrl(
    modelId: string,
    filename: string,
    contentType: string
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    const model = await this.repo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.status !== 'pending' && model.status !== 'uploading') {
      throw new Error('Cannot add images to model in current status');
    }

    if (model.training_images_s3_keys.length >= MAX_TRAINING_IMAGES) {
      throw new Error(`Maximum ${MAX_TRAINING_IMAGES} images allowed`);
    }

    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `influencer-models/${modelId}/training-images/${timestamp}_${safeName}`;

    const command = new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });

    // Update status to uploading if still pending
    if (model.status === 'pending') {
      await this.repo.update(modelId, { status: 'uploading' });
    }

    return { uploadUrl, s3Key };
  }

  /**
   * Confirm an image upload after successful S3 upload
   */
  async confirmImageUpload(modelId: string, s3Key: string): Promise<InfluencerModel> {
    const model = await this.repo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    if (!s3Key.startsWith(`influencer-models/${modelId}/`)) {
      throw new Error('Invalid S3 key for this model');
    }

    const updated = await this.repo.addImageKey(modelId, s3Key);
    logger.debug({ modelId, s3Key, imageCount: updated.training_images_s3_keys.length }, 'Image upload confirmed');
    return updated;
  }

  /**
   * Remove an image from a model
   */
  async removeImage(modelId: string, s3Key: string): Promise<InfluencerModel> {
    const model = await this.repo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.status !== 'pending' && model.status !== 'uploading') {
      throw new Error('Cannot remove images from model in current status');
    }

    // Delete from S3
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key })
    );

    const updated = await this.repo.removeImageKey(modelId, s3Key);
    logger.debug({ modelId, s3Key }, 'Image removed from model');
    return updated;
  }

  /**
   * Get presigned URLs for viewing training images
   */
  async getImageUrls(modelId: string): Promise<{ s3Key: string; url: string }[]> {
    const model = await this.repo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    const urls = await Promise.all(
      model.training_images_s3_keys.map(async (s3Key) => {
        const url = await getSignedUrl(
          this.s3Client,
          new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
          { expiresIn: 3600 }
        );
        return { s3Key, url };
      })
    );

    return urls;
  }

  // =========================================================================
  // Training Pipeline
  // =========================================================================

  /**
   * Start training a model
   */
  async startTraining(modelId: string): Promise<InfluencerModel> {
    if (!FAL_API_KEY) {
      throw new Error('FAL_API_KEY not configured');
    }

    const model = await this.repo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.status !== 'pending' && model.status !== 'uploading') {
      throw new Error(`Cannot start training from status: ${model.status}`);
    }

    const imageCount = model.training_images_s3_keys.length;
    if (imageCount < MIN_TRAINING_IMAGES) {
      throw new Error(`Need at least ${MIN_TRAINING_IMAGES} images, have ${imageCount}`);
    }

    // Step 1: Create ZIP of training images
    logger.info({ modelId, imageCount }, 'Creating training ZIP');
    const zipS3Key = await this.createTrainingZip(model);

    // Step 2: Get presigned URL for the ZIP
    const zipUrl = await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: zipS3Key }),
      { expiresIn: 86400 } // 24 hours for FAL to download
    );

    // Step 3: Submit to FAL.ai
    logger.info({ modelId }, 'Submitting training job to FAL.ai');
    const falJobId = await this.submitFalTraining(model, zipUrl);

    // Step 4: Update model status
    const updated = await this.repo.update(modelId, {
      status: 'training',
      training_zip_s3_key: zipS3Key,
      fal_training_job_id: falJobId,
      training_started_at: new Date(),
    });

    logger.info({ modelId, falJobId }, 'Training started');
    return updated;
  }

  /**
   * Check training status and update model
   */
  async checkTrainingStatus(modelId: string): Promise<InfluencerModel> {
    const model = await this.repo.findById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.status !== 'training') {
      return model;
    }

    if (!model.fal_training_job_id) {
      throw new Error('No FAL job ID for this model');
    }

    const status = await this.getFalStatus(model.fal_training_job_id);

    switch (status.status) {
      case 'IN_QUEUE':
      case 'IN_PROGRESS':
        // Still training, no update needed
        return model;

      case 'COMPLETED':
        // Download and store LoRA weights
        logger.info({ modelId }, 'Training completed, downloading LoRA weights');
        return await this.downloadAndStoreLoraWeights(model);

      case 'FAILED':
        logger.error({ modelId, error: status.error }, 'Training failed');
        return await this.repo.update(modelId, {
          status: 'failed',
          status_message: status.error || 'Training failed',
        });

      default:
        return model;
    }
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Create a ZIP file of training images and upload to S3
   */
  private async createTrainingZip(model: InfluencerModel): Promise<string> {
    const zipS3Key = `influencer-models/${model.id}/training.zip`;

    // Create a writable stream for the zip
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 5 } });

    archive.on('data', (chunk) => chunks.push(chunk));

    // Add each image to the archive
    for (let i = 0; i < model.training_images_s3_keys.length; i++) {
      const imageKey = model.training_images_s3_keys[i]!;
      const response = await this.s3Client.send(
        new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: imageKey })
      );

      if (response.Body) {
        const stream = response.Body as Readable;
        const ext = imageKey.split('.').pop() || 'jpg';
        archive.append(stream, { name: `image_${i.toString().padStart(3, '0')}.${ext}` });
      }
    }

    await archive.finalize();

    // Wait for all data
    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const zipBuffer = Buffer.concat(chunks);

    // Upload ZIP to S3
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: S3_MEDIA_BUCKET,
        Key: zipS3Key,
        Body: zipBuffer,
        ContentType: 'application/zip',
      })
    );

    logger.debug({ modelId: model.id, zipS3Key, sizeBytes: zipBuffer.length }, 'Training ZIP uploaded');
    return zipS3Key;
  }

  /**
   * Submit training job to FAL.ai
   */
  private async submitFalTraining(model: InfluencerModel, zipUrl: string): Promise<string> {
    const response = await fetch(`${FAL_API_BASE}/${FAL_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images_data_url: zipUrl,
        trigger_word: model.trigger_word,
        is_style: model.is_style,
        steps: model.training_steps,
        create_masks: true,
        rank: 16,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`FAL.ai submission failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as FalSubmitResponse;
    return data.request_id;
  }

  /**
   * Get training status from FAL.ai
   */
  private async getFalStatus(jobId: string): Promise<FalStatusResponse> {
    const response = await fetch(`${FAL_API_BASE}/${FAL_MODEL}/requests/${jobId}/status`, {
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`FAL.ai status check failed: ${response.status}`);
    }

    return (await response.json()) as FalStatusResponse;
  }

  /**
   * Download LoRA weights from FAL and store in S3
   */
  private async downloadAndStoreLoraWeights(model: InfluencerModel): Promise<InfluencerModel> {
    // First, update status to downloading
    await this.repo.update(model.id, { status: 'downloading' });

    // Get the result from FAL
    const resultResponse = await fetch(
      `${FAL_API_BASE}/${FAL_MODEL}/requests/${model.fal_training_job_id}`,
      {
        headers: {
          Authorization: `Key ${FAL_API_KEY}`,
        },
      }
    );

    if (!resultResponse.ok) {
      throw new Error(`Failed to get FAL result: ${resultResponse.status}`);
    }

    const result = (await resultResponse.json()) as FalResultResponse;
    const loraUrl = result.diffusers_lora_file.url;

    // Download the LoRA file
    const loraResponse = await fetch(loraUrl);
    if (!loraResponse.ok) {
      throw new Error(`Failed to download LoRA: ${loraResponse.status}`);
    }

    const loraBuffer = Buffer.from(await loraResponse.arrayBuffer());
    const loraS3Key = `influencer-models/${model.id}/lora.safetensors`;

    // Upload to S3
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: S3_MEDIA_BUCKET,
        Key: loraS3Key,
        Body: loraBuffer,
        ContentType: 'application/octet-stream',
      })
    );

    logger.info({ modelId: model.id, loraS3Key, sizeBytes: loraBuffer.length }, 'LoRA weights stored in S3');

    // Update model to ready
    return await this.repo.update(model.id, {
      status: 'ready',
      lora_s3_key: loraS3Key,
      fal_result_url: loraUrl,
      training_completed_at: new Date(),
    });
  }

  /**
   * Get presigned URL for downloading LoRA weights
   */
  async getLoraDownloadUrl(modelId: string): Promise<string | null> {
    const model = await this.repo.findById(modelId);
    if (!model || !model.lora_s3_key) {
      return null;
    }

    return await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: model.lora_s3_key }),
      { expiresIn: 3600 }
    );
  }

  // =========================================================================
  // Sample Generation
  // =========================================================================

  /**
   * Generate a sample image using the trained LoRA
   */
  async generateSample(
    modelId: string,
    input: GenerateSampleInput,
    tx?: TransactionContext
  ): Promise<InfluencerModelSample> {
    if (!FAL_API_KEY) {
      throw new Error('FAL_API_KEY not configured');
    }

    const model = await this.repo.findById(modelId, tx);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.status !== 'ready') {
      throw new Error('Model is not ready for sample generation');
    }

    if (!model.fal_result_url) {
      throw new Error('Model has no LoRA URL');
    }

    const validated = GenerateSampleSchema.parse(input);

    // Create sample record
    const sampleData: InfluencerModelSampleInsert = {
      model_id: modelId,
      prompt: validated.prompt,
      negative_prompt: validated.negative_prompt,
      guidance_scale: validated.guidance_scale,
      lora_scale: validated.lora_scale,
      num_inference_steps: validated.num_inference_steps,
      seed: validated.seed,
      width: validated.width,
      height: validated.height,
    };

    const sample = await this.repo.createSample(sampleData, tx);

    // Start generation asynchronously
    this.executeGeneration(sample.id, model, validated).catch((err) => {
      logger.error({ error: err, sampleId: sample.id }, 'Sample generation failed');
    });

    logger.info({ modelId, sampleId: sample.id }, 'Sample generation started');
    return sample;
  }

  /**
   * Execute the actual FAL generation
   */
  private async executeGeneration(
    sampleId: string,
    model: InfluencerModel,
    params: GenerateSampleInput
  ): Promise<void> {
    try {
      // Update to generating
      await this.repo.updateSample(sampleId, { status: 'generating' });

      // Build prompt with trigger word
      const fullPrompt = `${params.prompt}, ${model.trigger_word}`;

      // Submit to FAL
      const response = await fetch(`https://fal.run/${FAL_INFERENCE_MODEL}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${FAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          negative_prompt: params.negative_prompt,
          loras: [
            {
              path: model.fal_result_url,
              scale: params.lora_scale,
            },
          ],
          guidance_scale: params.guidance_scale,
          num_inference_steps: params.num_inference_steps,
          seed: params.seed,
          image_size: {
            width: params.width,
            height: params.height,
          },
          num_images: 1,
          enable_safety_checker: false,
          output_format: 'png',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FAL inference failed: ${response.status} ${errorText}`);
      }

      const result = (await response.json()) as FalInferenceResponse;

      if (!result.images || result.images.length === 0) {
        throw new Error('No images generated');
      }

      const imageUrl = result.images[0]!.url;

      // Download image and upload to S3
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const s3Key = `influencer-models/${model.id}/samples/${sampleId}.png`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: S3_MEDIA_BUCKET,
          Key: s3Key,
          Body: imageBuffer,
          ContentType: 'image/png',
        })
      );

      // Get presigned URL for the image
      const presignedUrl = await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
        { expiresIn: 86400 } // 24 hours
      );

      // Update sample with result
      await this.repo.updateSample(sampleId, {
        status: 'completed',
        image_s3_key: s3Key,
        image_url: presignedUrl,
        completed_at: new Date(),
      });

      logger.info({ sampleId, modelId: model.id, s3Key }, 'Sample generation completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, sampleId }, 'Sample generation failed');
      await this.repo.updateSample(sampleId, {
        status: 'failed',
        error_message: message,
      });
    }
  }

  /**
   * Get a sample by ID
   */
  async getSample(sampleId: string, tx?: TransactionContext): Promise<InfluencerModelSample | null> {
    return this.repo.findSampleById(sampleId, tx);
  }

  /**
   * List samples for a model
   */
  async listSamples(modelId: string, limit = 50, tx?: TransactionContext): Promise<InfluencerModelSample[]> {
    return this.repo.listSamples(modelId, limit, tx);
  }

  /**
   * Delete a sample
   */
  async deleteSample(sampleId: string, tx?: TransactionContext): Promise<void> {
    const sample = await this.repo.findSampleById(sampleId, tx);
    if (!sample) {
      throw new Error('Sample not found');
    }

    // Delete from S3 if exists
    if (sample.image_s3_key) {
      await this.s3Client
        .send(new DeleteObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: sample.image_s3_key }))
        .catch((err) => logger.warn({ key: sample.image_s3_key, error: err }, 'Failed to delete sample image'));
    }

    await this.repo.deleteSample(sampleId, tx);
    logger.info({ sampleId }, 'Sample deleted');
  }

  /**
   * Refresh presigned URL for a sample image
   */
  async refreshSampleUrl(sampleId: string, tx?: TransactionContext): Promise<string | null> {
    const sample = await this.repo.findSampleById(sampleId, tx);
    if (!sample || !sample.image_s3_key) {
      return null;
    }

    const url = await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: sample.image_s3_key }),
      { expiresIn: 86400 }
    );

    // Update the stored URL
    await this.repo.updateSample(sampleId, { image_url: url }, tx);
    return url;
  }
}

// =========================================================================
// Singleton
// =========================================================================

let serviceInstance: InfluencerModelsService | null = null;

export function getInfluencerModelsService(): InfluencerModelsService {
  if (!serviceInstance) {
    serviceInstance = new InfluencerModelsService();
  }
  return serviceInstance;
}
