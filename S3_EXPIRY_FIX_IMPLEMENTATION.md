# S3 Expiry Fix - Implementation

## Step 1: Make S3 Bucket Publicly Readable

### AWS Console
1. Go to S3 → Select your media bucket
2. Permissions → Block Public Access → Edit
3. Uncheck "Block all public access"
4. Save changes

### Bucket Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-MEDIA-BUCKET/*",
      "Condition": {
        "StringLike": {
          "s3:ExistingObjectTag/public": "true"
        }
      }
    }
  ]
}
```

**OR** for all objects (simpler):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-MEDIA-BUCKET/companions/*"
    }
  ]
}
```

## Step 2: Update Code to Use Direct S3 URLs

### File: `packages/gateway/src/routes/imagegen.ts`

**BEFORE (Lines 189-229):**
```typescript
async function getCompanionIdentityAnchorUrl(
  companionId: string,
  emotionalState?: string
): Promise<string | null> {
  // ... selection logic ...

  if (s3Key && s3Bucket) {
    const freshUrl = await getSignedUrl(  // ❌ REMOVE THIS
      s3Client,
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      }),
      { expiresIn: 3600 } // 1 hour
    );
    return freshUrl;
  }

  if (selectedAnchor.asset_url) {
    return selectedAnchor.asset_url;
  }
}
```

**AFTER:**
```typescript
async function getCompanionIdentityAnchorUrl(
  companionId: string,
  emotionalState?: string
): Promise<string | null> {
  const companionRepo = getCompanionsRepository();

  try {
    // Fetch all identity anchors for emotion-matched selection
    const anchors = await companionRepo.getAllIdentityAnchors(companionId);
    if (anchors.length > 0) {
      // Select best anchor based on emotional state
      const selectedAnchor = selectBestAnchor(anchors, emotionalState || 'neutral');
      if (selectedAnchor) {
        const metadata = selectedAnchor.metadata as Record<string, unknown> | null | undefined;
        const s3Key =
          selectedAnchor.s3_key ||
          (metadata?.['s3_key'] as string | undefined) ||
          (metadata?.['s3Key'] as string | undefined);
        const s3Bucket =
          selectedAnchor.s3_bucket ||
          (metadata?.['s3_bucket'] as string | undefined) ||
          (metadata?.['s3Bucket'] as string | undefined) ||
          S3_MEDIA_BUCKET;

        // ✅ Use direct S3 URL (no expiry)
        if (s3Key && s3Bucket) {
          const directUrl = `https://${s3Bucket}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;
          logger.debug({
            companionId,
            anchorId: selectedAnchor.id,
            s3Key,
            requestedEmotion: emotionalState,
            selectedEmotion: selectedAnchor.metadata?.emotionalState,
            anchorCount: anchors.length,
          }, 'Using emotion-matched identity anchor');
          return directUrl;
        }

        // Fallback to stored URL if no s3_key
        if (selectedAnchor.asset_url) {
          logger.debug({
            companionId,
            anchorId: selectedAnchor.id,
            requestedEmotion: emotionalState,
            selectedEmotion: selectedAnchor.metadata?.emotionalState,
          }, 'Using stored identity anchor URL (no s3_key)');
          return selectedAnchor.asset_url;
        }
      }
    }

    // If no stored anchors, try to build URL from companion's appearance settings
    const companion = await companionRepo.findById(companionId);
    if (!companion?.spec) {
      logger.debug({ companionId }, 'Companion not found or has no spec');
      return null;
    }

    // Extract appearance from spec
    const appearance = getAppearanceFromSpec(companion.spec);
    if (!appearance) {
      logger.debug({ companionId }, 'Companion has no valid appearance settings');
      return null;
    }

    // Build S3 URL to pre-generated variation image
    const variationUrl = getVariationUrl(appearance);
    logger.debug({ companionId, variationUrl }, 'Using pre-generated variation as anchor');
    return variationUrl;
  } catch (error) {
    logger.error({ error, companionId }, 'Error getting companion identity anchor');
    return null;
  }
}
```

### File: `packages/gateway/src/routes/imagegen.ts` - Remove Import

**BEFORE:**
```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';  // ❌ REMOVE
```

**AFTER:**
```typescript
// ✅ Remove this import entirely if no longer used
```

### File: `packages/gateway/src/utils/webcam-storage.ts` (Optional)

**Decision:** Keep presigned URLs for webcam frames for privacy (7-day expiry is acceptable)

**OR** if you want to make them public:

```typescript
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

  // ✅ Use direct S3 URL (no expiry)
  const s3Url = `https://${S3_MEDIA_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;

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
```

## Step 3: Update Image Upload to Tag Objects

Add public tag when uploading companion images:

### File: `packages/workers/src/image/worker.ts`

**Line 189-206 - Add tagging:**
```typescript
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
        Tagging: 'public=true',  // ✅ Add this for public access
      })
    );

    this.config.logger.debug(
      { s3Key, size: r.size, format: r.format, bytes: r.buffer.length },
      'Uploaded rendition'
    );
  });

  await Promise.all(uploads);
}
```

## Step 4: Test

### 1. Upload Test Script

```bash
# Test S3 bucket is public
aws s3 cp test-image.png s3://YOUR-MEDIA-BUCKET/test/test-image.png --acl public-read

# Test URL (should work in browser)
https://YOUR-MEDIA-BUCKET.s3.us-east-1.amazonaws.com/test/test-image.png
```

### 2. Test Old Companions

```bash
# Query database for old companion with images
psql $DATABASE_URL -c "SELECT id, name, spec->'visual_style'->'appearance' FROM companions LIMIT 5;"

# Check if their avatars load in browser
# Get avatar URLs from companion_avatars table
psql $DATABASE_URL -c "SELECT asset_url FROM companion_avatars WHERE companion_id = 'COMPANION_ID';"
```

### 3. Test New Image Generation

```bash
# Create new companion and generate anchor images
# Check that URLs are direct S3 URLs (not presigned)
# URLs should NOT contain:
# - X-Amz-Algorithm
# - X-Amz-Credential
# - X-Amz-Signature
# - X-Amz-Expires
```

## Step 5: Database Migration (Optional)

If you want to update existing presigned URLs in database:

```sql
-- Find all companion_avatars with presigned URLs
SELECT id, asset_url
FROM companion_avatars
WHERE asset_url LIKE '%X-Amz-Signature%'
LIMIT 10;

-- Update to direct S3 URLs (if s3_key and s3_bucket are stored)
UPDATE companion_avatars
SET asset_url = 'https://' || s3_bucket || '.s3.us-east-1.amazonaws.com/' || s3_key
WHERE s3_key IS NOT NULL
  AND s3_bucket IS NOT NULL
  AND asset_url LIKE '%X-Amz-Signature%';

-- Verify
SELECT id, asset_url
FROM companion_avatars
WHERE asset_url LIKE '%X-Amz-Signature%';
-- Should return 0 rows
```

## Rollback Plan

If issues occur:

1. Revert S3 bucket policy (make private again)
2. Restore previous code with presigned URLs
3. Deploy fixed version

## Phase 2: CloudFront (Future)

1. Create CloudFront distribution pointing to S3 bucket
2. Update environment variables:
   ```bash
   CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net
   ```
3. Update URL building functions:
   ```typescript
   const buildMediaUrl = (s3Key: string) => {
     const domain = env.CLOUDFRONT_DOMAIN || `${S3_MEDIA_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
     return `https://${domain}/${s3Key}`;
   };
   ```
4. Configure CloudFront caching and compression
5. Test and deploy

## Benefits

- ✅ No more 404 errors on old companions
- ✅ Faster image loading (no presigned URL generation)
- ✅ Simpler code
- ✅ Better scalability
- ✅ CDN-ready for future optimization
