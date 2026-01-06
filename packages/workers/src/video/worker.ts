/**
 * Video Generation Worker
 *
 * BullMQ worker that processes video generation jobs.
 * Calls orchestrator for AnimateDiff generation, uploads to S3, and updates database.
 */

import { Worker, Job } from 'bullmq';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { env } from '../env.js';

export const VIDEO_GENERATION_QUEUE = 'video-generation';

export interface VideoGenerationJobData {
  videoRequestId: string;
  userId: string;
  companionId: string;
  prompt: string;
  referenceImageUrl?: string;
  referenceImageS3Bucket?: string;
  referenceImageS3Key?: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export interface VideoGenerationResult {
  videoRequestId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  processingTimeMs: number;
}

interface VideoGenerationWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
  orchestratorUrl?: string;
}

export class VideoGenerationWorker {
  private worker: Worker<VideoGenerationJobData, VideoGenerationResult> | null = null;
  private config: VideoGenerationWorkerConfig;
  private s3Client: S3Client;
  private region: string;
  private bucket: string;
  private orchestratorUrl: string;

  constructor(config: VideoGenerationWorkerConfig) {
    this.config = config;
    this.region = env.AWS_REGION;
    this.bucket = env.S3_BUCKET_MEDIA || env.S3_MEDIA_BUCKET;
    this.orchestratorUrl = config.orchestratorUrl || env.ORCHESTRATOR_URL;
    this.s3Client = new S3Client({ region: this.region });
  }

  async start(): Promise<void> {
    this.worker = new Worker<VideoGenerationJobData, VideoGenerationResult>(
      VIDEO_GENERATION_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 1, // Limit concurrency for GPU-intensive work
      }
    );

    this.worker.on('completed', (job, result) => {
      this.config.logger.info(
        {
          jobId: job.id,
          videoRequestId: result.videoRequestId,
          processingTimeMs: result.processingTimeMs,
        },
        'Video generation job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Video generation job failed'
      );
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 1 },
      'Video generation worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Video generation worker stopped');
    }
  }

  private async process(
    job: Job<VideoGenerationJobData>
  ): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    const { data } = job;
    const {
      videoRequestId,
      userId,
      companionId,
      prompt,
      referenceImageUrl,
      referenceImageS3Bucket,
      referenceImageS3Key,
      durationSeconds,
      width,
      height,
      fps,
    } = data;

    this.config.logger.info(
      { videoRequestId, userId, companionId, prompt: prompt.substring(0, 100) },
      'Processing video generation request'
    );

    // Update status to generating
    await this.updateStatus(videoRequestId, 'generating');

    try {
      // Calculate frames from duration
      const frames = Math.floor(durationSeconds * fps);

      // Call orchestrator to generate video
      const videoResult = await this.callOrchestrator(prompt, {
        width,
        height,
        frames,
        fps,
        referenceImageUrl,
        referenceImageS3Bucket,
        referenceImageS3Key,
      });

      // Update status to encoding
      await this.updateStatus(videoRequestId, 'encoding');

      // Upload video to S3
      const s3Key = `videos/${userId}/${companionId}/${videoRequestId}.mp4`;
      const videoUrl = await this.uploadToS3(
        s3Key,
        videoResult.videoData,
        'video/mp4'
      );

      // Generate and upload thumbnail (first frame)
      let thumbnailUrl: string | undefined;
      if (videoResult.thumbnailData) {
        const thumbnailKey = `videos/${userId}/${companionId}/${videoRequestId}_thumb.jpg`;
        thumbnailUrl = await this.uploadToS3(
          thumbnailKey,
          videoResult.thumbnailData,
          'image/jpeg'
        );
      }

      const processingTimeMs = Date.now() - startTime;

      // Update database with completed status and URLs
      await this.setVideoReady(videoRequestId, videoUrl, thumbnailUrl, processingTimeMs);

      this.config.logger.info(
        {
          videoRequestId,
          processingTimeMs,
          videoUrl,
        },
        'Video generation completed successfully'
      );

      return {
        videoRequestId,
        videoUrl,
        thumbnailUrl,
        processingTimeMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.config.logger.error(
        { videoRequestId, error: errorMessage },
        'Video generation failed'
      );

      // Update status to failed
      await this.updateStatus(videoRequestId, 'failed', errorMessage);

      throw error;
    }
  }

  private async callOrchestrator(
    prompt: string,
    options: {
      width: number;
      height: number;
      frames: number;
      fps: number;
      referenceImageUrl?: string;
      referenceImageS3Bucket?: string;
      referenceImageS3Key?: string;
    }
  ): Promise<{ videoData: Buffer; thumbnailData?: Buffer }> {
    let referenceImageUrl = options.referenceImageUrl;

    // Prefer presigning just-in-time so queued jobs don't fail due to expired URLs.
    if (options.referenceImageS3Key) {
      try {
        const bucket = options.referenceImageS3Bucket || this.bucket;
        referenceImageUrl = await getSignedUrl(
          this.s3Client,
          new GetObjectCommand({ Bucket: bucket, Key: options.referenceImageS3Key }),
          { expiresIn: 3600 }
        );
      } catch (error) {
        this.config.logger.warn(
          { error, s3Key: options.referenceImageS3Key },
          'Failed to presign reference image URL; falling back to provided URL'
        );
      }
    }

    const response = await fetch(`${this.orchestratorUrl}/videogen/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        width: options.width,
        height: options.height,
        frames: options.frames,
        fps: options.fps,
        reference_image_url: referenceImageUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orchestrator error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { video_base64: string };
    const videoData = Buffer.from(result.video_base64, 'base64');

    // TODO: Extract first frame as thumbnail using ffmpeg
    // For now, we skip thumbnail generation
    return { videoData };
  }

  private async uploadToS3(
    key: string,
    data: Buffer,
    contentType: string
  ): Promise<string> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'max-age=31536000', // 1 year
      })
    );

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private async updateStatus(
    videoRequestId: string,
    status: 'pending' | 'generating' | 'encoding' | 'ready' | 'failed',
    error?: string
  ): Promise<void> {
    if (error) {
      await this.config.db.sql`
        UPDATE video_requests
        SET status = ${status}, generation_error = ${error}
        WHERE id = ${videoRequestId}
      `;
    } else {
      await this.config.db.sql`
        UPDATE video_requests
        SET status = ${status}
        WHERE id = ${videoRequestId}
      `;
    }
  }

  private async setVideoReady(
    videoRequestId: string,
    videoUrl: string,
    thumbnailUrl: string | undefined,
    processingTimeMs: number
  ): Promise<void> {
    await this.config.db.sql`
      UPDATE video_requests
      SET
        status = 'ready',
        video_url = ${videoUrl},
        thumbnail_url = ${thumbnailUrl || null},
        processing_time_ms = ${processingTimeMs},
        completed_at = NOW()
      WHERE id = ${videoRequestId}
    `;
  }
}
