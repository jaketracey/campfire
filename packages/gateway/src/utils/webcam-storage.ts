/**
 * Webcam Storage Utility
 * Handles S3 uploads for webcam frames captured during chat sessions.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';

// S3 configuration
const S3_MEDIA_BUCKET = env.S3_MEDIA_BUCKET;
const S3_REGION = env.AWS_REGION;

// Initialize S3 client
const s3Client = new S3Client({ region: S3_REGION });

export interface WebcamFrameUploadResult {
  s3Key: string;
  s3Url: string;
  sizeBytes: number;
}

/**
 * Upload a webcam frame to S3
 * @param userId - User ID for path organization
 * @param sessionId - Session ID for path organization
 * @param base64Data - Base64 encoded JPEG image data
 * @param width - Image width
 * @param height - Image height
 * @returns S3 key and presigned URL
 */
export async function uploadWebcamFrame(
  userId: string,
  sessionId: string,
  base64Data: string,
  width: number,
  height: number
): Promise<WebcamFrameUploadResult> {
  const imageBuffer = Buffer.from(base64Data, 'base64');
  const timestamp = Date.now();
  const s3Key = `webcam/${userId}/${sessionId}/${timestamp}.jpg`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: 'image/jpeg',
      CacheControl: 'max-age=86400', // 1 day cache
      Metadata: {
        width: width.toString(),
        height: height.toString(),
        capturedAt: new Date(timestamp).toISOString(),
      },
    })
  );

  // Generate presigned URL valid for 7 days
  const s3Url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: s3Key }),
    { expiresIn: 604800 }
  );

  logger.debug(
    { s3Key, sizeBytes: imageBuffer.length, width, height },
    'Webcam frame uploaded to S3'
  );

  return {
    s3Key,
    s3Url,
    sizeBytes: imageBuffer.length,
  };
}
