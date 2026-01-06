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
        concurrency: this.config.concurrency || 2, // CPU-intensive, limit concurrency
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
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Image rendition job failed'
      );
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 2 },
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
    const { data } = job;
    const {
      originalS3Key,
      bucket,
      userId,
      sessionId,
      cacheKey,
      imageId,
      isAnchor,
    } = data;

    this.config.logger.info(
      { imageId, originalS3Key, isAnchor },
      'Processing image renditions'
    );

    // Download original image from S3
    const originalBuffer = await this.downloadFromS3(bucket, originalS3Key);
    const originalSize = originalBuffer.length;

    // Determine which sizes to generate
    const sizesToGenerate = isAnchor
      ? RENDITION_CONFIGS.anchor
      : RENDITION_CONFIGS.session;

    // Process renditions
    const renditions = await processImageRenditions(originalBuffer, {
      sizes: [...sizesToGenerate],
      keepOriginal: true,
    });

    // Upload all renditions to S3
    const keyPrefix = getRenditionKeyPrefix(userId, sessionId, cacheKey);
    await this.uploadRenditions(bucket, keyPrefix, renditions);

    // Group renditions into structured object
    const groupedRenditions = groupRenditions(
      renditions,
      (size, format) => getRenditionS3Key(keyPrefix, size, format),
      (s3Key) => this.buildS3Url(bucket, s3Key)
    );

    // Update database with renditions
    await this.updateImageRenditions(imageId, groupedRenditions);

    const processingTimeMs = Date.now() - startTime;
    const bytesSaved = calculateBytesSaved(originalSize, renditions);

    this.config.logger.info(
      {
        imageId,
        renditionCount: renditions.length,
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

  private async uploadRenditions(
    bucket: string,
    keyPrefix: string,
    renditions: ProcessedRendition[]
  ): Promise<void> {
    const uploads = renditions.map(async (r) => {
      const s3Key = getRenditionS3Key(keyPrefix, r.size, r.format);
      const contentType = getContentType(r.format);

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: r.buffer,
          ContentType: contentType,
          CacheControl: 'max-age=31536000', // 1 year
        })
      );

      this.config.logger.debug(
        { s3Key, size: r.size, format: r.format, bytes: r.buffer.length },
        'Uploaded rendition'
      );
    });

    await Promise.all(uploads);
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
      SET renditions = ${JSON.stringify(renditions)}::jsonb
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
