/**
 * Image Rendition Worker
 *
 * BullMQ worker that processes image rendition jobs.
 * Downloads original from S3, generates renditions, uploads them, and updates database.
 */

import { Worker, Job } from 'bullmq';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { env } from '../env.js';
import {
  type ImageRenditionJobData,
  type ImageRenditionResult,
  type ImageRenditions,
  RENDITION_CONFIGS,
  getRenditionKeyPrefix,
  getRenditionS3Key,
} from '@campfire/shared';
import {
  processImageRenditions,
  groupRenditions,
  calculateBytesSaved,
  getContentType,
  type ProcessedRendition,
} from './processor.js';

export const IMAGE_RENDITION_QUEUE = 'image-renditions';

interface ImageRenditionWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
}

const IMAGE_RENDITION_LOCK_DURATION_MS = 600000;
const IMAGE_RENDITION_LOCK_RENEW_TIME_MS = 60000;
const IMAGE_RENDITION_STALLED_INTERVAL_MS = 60000;
const IMAGE_RENDITION_MAX_STALLED_COUNT = 3;

export class ImageRenditionWorker {
  private worker: Worker<ImageRenditionJobData, ImageRenditionResult> | null = null;
  private config: ImageRenditionWorkerConfig;
  private s3Client: S3Client;
  private region: string;

  constructor(config: ImageRenditionWorkerConfig) {
    this.config = config;
    this.region = env.AWS_REGION;
    this.s3Client = new S3Client({ region: this.region });
  }

  async start(): Promise<void> {
    this.worker = new Worker<ImageRenditionJobData, ImageRenditionResult>(
      IMAGE_RENDITION_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 1, // CPU-intensive, limit concurrency
        lockDuration: IMAGE_RENDITION_LOCK_DURATION_MS,
        lockRenewTime: IMAGE_RENDITION_LOCK_RENEW_TIME_MS,
        stalledInterval: IMAGE_RENDITION_STALLED_INTERVAL_MS,
        maxStalledCount: IMAGE_RENDITION_MAX_STALLED_COUNT,
      }
    );

    this.worker.on('completed', (job, result) => {
      this.config.logger.info(
        {
          jobId: job.id,
          imageId: result.imageId,
          processingTimeMs: result.processingTimeMs,
          bytesSaved: result.bytesSaved,
        },
        'Image rendition job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      const imageId = job?.data?.imageId;
      this.config.logger.error(
        {
          jobId: job?.id,
          imageId,
          attemptsMade: job?.attemptsMade,
          attemptsLimit: job?.opts.attempts,
          error: err.message,
        },
        'Image rendition job failed'
      );
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 1 },
      'Image rendition worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Image rendition worker stopped');
    }
  }

  private async process(
    job: Job<ImageRenditionJobData>
  ): Promise<ImageRenditionResult> {
    const startTime = Date.now();
    await job.updateProgress(5);
    const { data } = job;
    const {
      originalS3Key,
      bucket,
      userId,
      sessionId,
      cacheKey,
      imageId,
      isAnchor,
      keyPrefix: explicitKeyPrefix,
    } = data;

    this.config.logger.info(
      { imageId, originalS3Key, isAnchor },
      'Processing image renditions'
    );

    // Download original image from S3
    await job.updateProgress(10);
    let originalBuffer: Buffer;
    try {
      originalBuffer = await this.downloadFromS3(bucket, originalS3Key);
    } catch (err) {
      this.config.logger.error(
        { imageId, originalS3Key, error: (err as Error).message },
        'Failed to download original image from S3'
      );
      throw err;
    }
    const originalSize = originalBuffer.length;

    // Validate that we received a valid image
    if (originalSize < 100) {
      throw new Error(`Downloaded image is too small (${originalSize} bytes), likely corrupted: ${originalS3Key}`);
    }

    // Determine which sizes to generate
    const sizesToGenerate = isAnchor
      ? RENDITION_CONFIGS.anchor
      : RENDITION_CONFIGS.session;

    // Process renditions
    await job.updateProgress(25);
    let renditions: ProcessedRendition[];
    try {
      renditions = await processImageRenditions(originalBuffer, {
        sizes: [...sizesToGenerate],
        keepOriginal: true,
      });
    } catch (err) {
      this.config.logger.error(
        { imageId, originalSize, error: (err as Error).message },
        'Failed to process image renditions (sharp error)'
      );
      throw err;
    }

    if (renditions.length === 0) {
      throw new Error(`No renditions generated for image ${imageId}`);
    }

    // Upload all renditions to S3
    // Use explicit keyPrefix if provided (for anchor images), otherwise construct from path components
    await job.updateProgress(70);
    const keyPrefix = explicitKeyPrefix || getRenditionKeyPrefix(userId, sessionId, cacheKey);
    const { uploaded, failed: uploadFailures } = await this.uploadRenditionsWithRetry(bucket, keyPrefix, renditions);

    if (uploadFailures.length > 0) {
      this.config.logger.warn(
        { imageId, failedCount: uploadFailures.length, failures: uploadFailures },
        'Some rendition uploads failed'
      );
    }

    if (uploaded.length === 0) {
      throw new Error(`All rendition uploads failed for image ${imageId}`);
    }

    // Group only successfully uploaded renditions into structured object
    await job.updateProgress(90);
    const groupedRenditions = groupRenditions(
      uploaded,
      (size, format) => getRenditionS3Key(keyPrefix, size, format),
      (s3Key) => this.buildS3Url(bucket, s3Key)
    );

    // Update database with renditions
    await job.updateProgress(95);
    await this.updateImageRenditions(imageId, groupedRenditions);

    const processingTimeMs = Date.now() - startTime;
    const bytesSaved = calculateBytesSaved(originalSize, uploaded);

    this.config.logger.info(
      {
        imageId,
        renditionCount: uploaded.length,
        processingTimeMs,
        bytesSaved,
        originalSize,
      },
      'Image renditions processed successfully'
    );

    return {
      imageId,
      renditions: groupedRenditions,
      processingTimeMs,
      bytesSaved,
    };
  }

  private async downloadFromS3(bucket: string, key: string): Promise<Buffer> {
    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!response.Body) {
      throw new Error(`Failed to download image from S3: ${key}`);
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Upload renditions to S3 with per-rendition error isolation.
   * Returns which renditions succeeded and which failed, so a single
   * upload failure (e.g., AVIF for one size) doesn't kill the whole job.
   */
  private async uploadRenditionsWithRetry(
    bucket: string,
    keyPrefix: string,
    renditions: ProcessedRendition[]
  ): Promise<{ uploaded: ProcessedRendition[]; failed: Array<{ size: string; format: string; error: string }> }> {
    const uploaded: ProcessedRendition[] = [];
    const failed: Array<{ size: string; format: string; error: string }> = [];

    const uploads = renditions.map(async (r) => {
      const s3Key = getRenditionS3Key(keyPrefix, r.size, r.format);
      const contentType = getContentType(r.format);

      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: r.buffer,
            ContentType: contentType,
            CacheControl: 'max-age=31536000, immutable', // 1 year, immutable (content-addressed)
          })
        );

        this.config.logger.debug(
          { s3Key, size: r.size, format: r.format, bytes: r.buffer.length },
          'Uploaded rendition'
        );
        uploaded.push(r);
      } catch (err) {
        failed.push({
          size: String(r.size),
          format: r.format,
          error: (err as Error).message,
        });
        this.config.logger.warn(
          { s3Key, size: r.size, format: r.format, error: (err as Error).message },
          'Failed to upload rendition'
        );
      }
    });

    await Promise.all(uploads);
    return { uploaded, failed };
  }

  private buildS3Url(bucket: string, key: string): string {
    return `https://${bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private async updateImageRenditions(
    imageId: string,
    renditions: ImageRenditions
  ): Promise<void> {
    await this.config.db.sql`
      UPDATE companion_images
      SET renditions = (${JSON.stringify(renditions)}::jsonb #>> '{}')::jsonb
      WHERE id = ${imageId}
    `;
  }
}

/**
 * Create a job to process image renditions
 * Call this from gateway after uploading the original image
 */
export function createRenditionJobData(
  originalS3Key: string,
  bucket: string,
  userId: string,
  sessionId: string,
  cacheKey: string,
  imageId: string,
  options?: { isAnchor?: boolean; companionId?: string }
): ImageRenditionJobData {
  return {
    originalS3Key,
    bucket,
    userId,
    sessionId,
    cacheKey,
    imageId,
    isAnchor: options?.isAnchor,
    companionId: options?.companionId,
  };
}
