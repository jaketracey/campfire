/**
 * Influencer Sample Generation Worker
 *
 * BullMQ worker that processes influencer sample generation jobs.
 * Calls FAL for inference, uploads sample images to S3, and updates DB status.
 */

import { Worker, Job } from 'bullmq';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { env } from '../env.js';

export const INFLUENCER_SAMPLE_GENERATION_QUEUE = 'influencer-sample-generation';
const FAL_INFERENCE_MODEL = 'fal-ai/flux-lora';
const FAL_INFERENCE_URL = `https://fal.run/${FAL_INFERENCE_MODEL}`;
const MAX_FETCH_RETRIES = 3;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface InfluencerSampleGenerationJobData {
  sampleId: string;
  modelId: string;
}

export interface InfluencerSampleGenerationResult {
  sampleId: string;
  modelId: string;
  imageUrl: string;
  processingTimeMs: number;
}

interface InfluencerSampleGenerationWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
}

interface InferenceImage {
  url: string;
}

interface FalInferenceResponse {
  images: InferenceImage[];
}

interface SampleWithModelRow {
  sample_id: string;
  model_id: string;
  prompt: string;
  negative_prompt: string | null;
  guidance_scale: number;
  lora_scale: number;
  num_inference_steps: number;
  seed: number | null;
  width: number;
  height: number;
  sample_status: 'pending' | 'generating' | 'completed' | 'failed';
  trigger_word: string;
  fal_result_url: string | null;
}

export class InfluencerSampleGenerationWorker {
  private worker: Worker<InfluencerSampleGenerationJobData, InfluencerSampleGenerationResult> | null = null;
  private config: InfluencerSampleGenerationWorkerConfig;
  private s3Client: S3Client;
  private bucket: string;

  constructor(config: InfluencerSampleGenerationWorkerConfig) {
    this.config = config;
    this.s3Client = new S3Client({ region: env.AWS_REGION });
    this.bucket = env.S3_BUCKET_MEDIA || env.S3_MEDIA_BUCKET;
  }

  async start(): Promise<void> {
    if (!env.FAL_API_KEY) {
      this.config.logger.warn('FAL_API_KEY not set, influencer sample generation worker is disabled');
      return;
    }

    this.worker = new Worker<InfluencerSampleGenerationJobData, InfluencerSampleGenerationResult>(
      INFLUENCER_SAMPLE_GENERATION_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 2,
      }
    );

    this.worker.on('completed', (job, result) => {
      this.config.logger.info(
        {
          jobId: job.id,
          sampleId: result.sampleId,
          modelId: result.modelId,
          processingTimeMs: result.processingTimeMs,
        },
        'Influencer sample generation job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        {
          jobId: job?.id,
          sampleId: job?.data?.sampleId,
          error: err.message,
        },
        'Influencer sample generation job failed'
      );
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 2 },
      'Influencer sample generation worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Influencer sample generation worker stopped');
    }
  }

  private async process(
    job: Job<InfluencerSampleGenerationJobData>
  ): Promise<InfluencerSampleGenerationResult> {
    const startTime = Date.now();
    const { sampleId, modelId } = job.data;

    this.config.logger.info({ sampleId, modelId }, 'Processing influencer sample generation request');

    const sample = await this.getSampleWithModel(sampleId);
    if (!sample) {
      throw new Error(`Sample not found: ${sampleId}`);
    }

    if (sample.sample_status === 'completed') {
      this.config.logger.info({ sampleId }, 'Sample already completed, skipping');
      const imageUrl = await this.getCurrentImageUrl(sampleId);
      return {
        sampleId,
        modelId: sample.model_id,
        imageUrl: imageUrl || '',
        processingTimeMs: Date.now() - startTime,
      };
    }

    if (!sample.fal_result_url) {
      const errorMessage = 'Model has no LoRA URL';
      await this.markSampleFailed(sampleId, errorMessage);
      throw new Error(errorMessage);
    }

    await this.markSampleGenerating(sampleId);

    try {
      const fullPrompt = `${sample.prompt}, ${sample.trigger_word}`;

      const inferenceResponse = await this.fetchWithRetry(
        FAL_INFERENCE_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Key ${env.FAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: fullPrompt,
            negative_prompt: sample.negative_prompt ?? undefined,
            loras: [
              {
                path: sample.fal_result_url,
                scale: sample.lora_scale,
              },
            ],
            guidance_scale: sample.guidance_scale,
            num_inference_steps: sample.num_inference_steps,
            seed: sample.seed ?? undefined,
            image_size: {
              width: sample.width,
              height: sample.height,
            },
            num_images: 1,
            enable_safety_checker: false,
            output_format: 'png',
          }),
        },
        { purpose: 'FAL sample inference', timeoutMs: DEFAULT_FETCH_TIMEOUT_MS }
      );

      const inferenceResult = await inferenceResponse.json() as FalInferenceResponse;
      const imageUrl = inferenceResult.images?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No images generated');
      }

      const imageResponse = await this.fetchWithRetry(
        imageUrl,
        {},
        { purpose: 'Generated image download', timeoutMs: 60_000 }
      );
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      const s3Key = `influencer-models/${sample.model_id}/samples/${sampleId}.png`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: imageBuffer,
          ContentType: 'image/png',
        })
      );

      const presignedUrl = await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
        { expiresIn: 86400 }
      );

      await this.config.db.sql`
        UPDATE influencer_model_samples
        SET
          status = 'completed',
          error_message = NULL,
          image_s3_key = ${s3Key},
          image_url = ${presignedUrl},
          completed_at = NOW()
        WHERE id = ${sampleId}
      `;

      const processingTimeMs = Date.now() - startTime;
      return {
        sampleId,
        modelId: sample.model_id,
        imageUrl: presignedUrl,
        processingTimeMs,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      await this.markSampleFailed(sampleId, message);
      throw error;
    }
  }

  private async getSampleWithModel(sampleId: string): Promise<SampleWithModelRow | null> {
    const rows = await this.config.db.sql`
      SELECT
        s.id AS sample_id,
        s.model_id,
        s.prompt,
        s.negative_prompt,
        s.guidance_scale,
        s.lora_scale,
        s.num_inference_steps,
        s.seed,
        s.width,
        s.height,
        s.status AS sample_status,
        m.trigger_word,
        m.fal_result_url
      FROM influencer_model_samples s
      JOIN influencer_models m ON m.id = s.model_id
      WHERE s.id = ${sampleId}
      LIMIT 1
    `;

    return (rows[0] as SampleWithModelRow | undefined) ?? null;
  }

  private async getCurrentImageUrl(sampleId: string): Promise<string | null> {
    const rows = await this.config.db.sql`
      SELECT image_url
      FROM influencer_model_samples
      WHERE id = ${sampleId}
      LIMIT 1
    `;
    return (rows[0]?.image_url as string | null | undefined) ?? null;
  }

  private async markSampleGenerating(sampleId: string): Promise<void> {
    await this.config.db.sql`
      UPDATE influencer_model_samples
      SET
        status = 'generating',
        error_message = NULL
      WHERE id = ${sampleId}
    `;
  }

  private async markSampleFailed(sampleId: string, message: string): Promise<void> {
    await this.config.db.sql`
      UPDATE influencer_model_samples
      SET
        status = 'failed',
        error_message = ${message.slice(0, 2000)}
      WHERE id = ${sampleId}
    `;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    options: {
      purpose: string;
      timeoutMs?: number;
      maxRetries?: number;
    }
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? MAX_FETCH_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let retryable = true;
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) {
          return response;
        }

        const responseBody = await response.text();
        const message = `${options.purpose} failed with ${response.status}: ${responseBody.slice(0, 500)}`;
        retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
        lastError = new Error(message);

        if (!retryable) {
          throw lastError;
        }
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error(String(error));
        }

        if (!retryable) {
          throw lastError;
        }
      }

      if (attempt === maxRetries) {
        throw lastError ?? new Error(`${options.purpose} failed`);
      }

      const delayMs = 500 * (2 ** (attempt - 1));
      await this.sleep(delayMs);
    }

    throw lastError ?? new Error(`${options.purpose} failed`);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
