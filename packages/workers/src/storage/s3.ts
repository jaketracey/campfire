import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

export function createS3Client() {
  const client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  const vaultBucket = process.env.S3_VAULT_BUCKET || 'campfire-vault-dev';
  const mediaBucket = process.env.S3_MEDIA_BUCKET || 'campfire-media-dev';

  return {
    async uploadVaultFile(key: string, content: string): Promise<string> {
      await client.send(
        new PutObjectCommand({
          Bucket: vaultBucket,
          Key: key,
          Body: content,
          ContentType: 'text/markdown',
        })
      );
      return `s3://${vaultBucket}/${key}`;
    },

    async deleteVaultFile(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: vaultBucket,
          Key: key,
        })
      );
    },

    async getVaultFile(key: string): Promise<string | null> {
      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: vaultBucket,
            Key: key,
          })
        );
        return await response.Body?.transformToString() ?? null;
      } catch {
        return null;
      }
    },

    async uploadMedia(key: string, content: Buffer, contentType: string): Promise<string> {
      await client.send(
        new PutObjectCommand({
          Bucket: mediaBucket,
          Key: key,
          Body: content,
          ContentType: contentType,
        })
      );
      return `s3://${mediaBucket}/${key}`;
    },

    async deleteMedia(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: mediaBucket,
          Key: key,
        })
      );
    },

    getVaultBucket: () => vaultBucket,
    getMediaBucket: () => mediaBucket,
  };
}

export type S3StorageClient = ReturnType<typeof createS3Client>;
