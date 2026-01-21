/**
 * S3 Storage Utilities
 * Provides a shared S3 client singleton for consistent connection pooling.
 */

import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { env } from '../env.js';

let s3ClientInstance: S3Client | null = null;

/**
 * Get the shared S3 client instance
 * Creates a singleton to reuse connections and improve performance
 */
export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const config: S3ClientConfig = {
      region: env.AWS_REGION,
    };

    // In development, allow local S3-compatible services
    if (env.NODE_ENV !== 'production' && process.env['AWS_ENDPOINT_URL']) {
      config.endpoint = process.env['AWS_ENDPOINT_URL'];
      config.forcePathStyle = true;
    }

    s3ClientInstance = new S3Client(config);
  }

  return s3ClientInstance;
}

/**
 * Get the S3 bucket name for media storage
 */
export function getMediaBucket(): string {
  return env.S3_MEDIA_BUCKET;
}

/**
 * Get the CDN URL for media if configured
 */
export function getCdnUrl(): string | undefined {
  return env.S3_CDN_URL;
}

/**
 * Build a public URL for an S3 object
 */
export function buildMediaUrl(key: string): string {
  const cdnUrl = getCdnUrl();
  if (cdnUrl) {
    return `${cdnUrl}/${key}`;
  }
  return `https://${getMediaBucket()}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Close the S3 client (for graceful shutdown)
 */
export function closeS3Client(): void {
  if (s3ClientInstance) {
    s3ClientInstance.destroy();
    s3ClientInstance = null;
  }
}
