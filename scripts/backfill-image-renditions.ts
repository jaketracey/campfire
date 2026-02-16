/**
 * Backfill Image Renditions for Existing Companion Images
 *
 * Processes companion_images rows that have no renditions (renditions IS NULL),
 * downloading originals from S3, generating WebP/AVIF at all standard sizes,
 * uploading renditions back to S3, and updating the database.
 *
 * Features:
 * - Idempotent: skips images that already have renditions
 * - Resumable: saves progress to JSON file, --resume to continue
 * - Batch processing with configurable concurrency
 * - Dry-run mode to preview work without making changes
 * - Graceful error handling per image (failures don't block others)
 *
 * Usage:
 *   npx tsx scripts/backfill-image-renditions.ts                  # Process all
 *   npx tsx scripts/backfill-image-renditions.ts --resume         # Resume from progress
 *   npx tsx scripts/backfill-image-renditions.ts --dry-run        # Preview without processing
 *   npx tsx scripts/backfill-image-renditions.ts --batch-size=50  # Custom batch size
 *   npx tsx scripts/backfill-image-renditions.ts --concurrent=2   # Limit concurrency
 *   npx tsx scripts/backfill-image-renditions.ts --limit=100      # Process first N images only
 *
 * Environment:
 *   DATABASE_URL    PostgreSQL connection string (or individual DATABASE_* vars)
 *   AWS_REGION      AWS region (default: us-east-1)
 *   S3_MEDIA_BUCKET S3 bucket name (default: campfire-dev-media)
 *   S3_CDN_URL      Optional CDN URL for building media URLs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration (mirrors @campfire/shared image-renditions constants)
// ============================================================================

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const S3_MEDIA_BUCKET = process.env.S3_MEDIA_BUCKET || 'campfire-dev-media';
const S3_CDN_URL = process.env.S3_CDN_URL;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://campfire:campfire@localhost:5432/campfire';

const PROGRESS_FILE = path.join(__dirname, '.backfill-renditions-progress.json');

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 3;
const DELAY_BETWEEN_BATCHES_MS = 500;

// Rendition sizes - must match @campfire/shared RENDITION_SIZES
const RENDITION_SIZES: Record<string, { width: number; height: number }> = {
  thumb: { width: 128, height: 192 },
  small: { width: 256, height: 384 },
  medium: { width: 512, height: 768 },
  large: { width: 832, height: 1248 },
};

// Session images use all sizes
const SESSION_SIZES = ['thumb', 'small', 'medium', 'large'] as const;

// Formats to generate - must match @campfire/shared FORMATS_TO_GENERATE
const FORMATS_TO_GENERATE = ['webp', 'avif'] as const;
type RenditionFormat = 'webp' | 'avif' | 'png';

// Quality settings - must match @campfire/shared FORMAT_QUALITY
const FORMAT_QUALITY: Record<string, number | undefined> = {
  webp: 82,
  avif: 75,
  png: undefined,
};

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
};

// ============================================================================
// Types
// ============================================================================

interface RenditionFile {
  s3Key: string;
  url: string;
  sizeBytes: number;
  format: string;
  width: number;
  height: number;
}

interface RenditionFormats {
  webp?: RenditionFile;
  avif?: RenditionFile;
  png?: RenditionFile;
}

interface ImageRenditions {
  thumb?: RenditionFormats;
  small?: RenditionFormats;
  medium?: RenditionFormats;
  large?: RenditionFormats;
  original?: RenditionFormats;
}

interface ProcessedRendition {
  size: string;
  format: RenditionFormat;
  buffer: Buffer;
  width: number;
  height: number;
}

interface CompanionImageRow {
  id: string;
  s3_key: string;
  user_id: string;
  session_id: string;
  cache_key: string;
  companion_id: string | null;
  width: number;
  height: number;
  size_bytes: number | null;
}

interface Progress {
  completed: string[];
  failed: string[];
  startedAt: string;
  lastUpdated: string;
  totalProcessed: number;
  totalBytesSaved: number;
}

interface CliArgs {
  resume: boolean;
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
  limit: number | null;
  clean: boolean;
}

// ============================================================================
// Path Helpers (mirrors @campfire/shared)
// ============================================================================

function getRenditionKeyPrefix(userId: string, sessionId: string, cacheKey: string): string {
  return `companions/${userId}/${sessionId}/${cacheKey}`;
}

function getRenditionS3Key(prefix: string, size: string, format: string): string {
  return `${prefix}/${size}.${format}`;
}

// ============================================================================
// Image Processing (mirrors packages/workers/src/image/processor.ts)
// ============================================================================

async function convertToFormat(image: sharp.Sharp, format: RenditionFormat): Promise<Buffer> {
  switch (format) {
    case 'webp':
      return image.webp({ quality: FORMAT_QUALITY.webp, effort: 6 }).toBuffer();
    case 'avif':
      return image.avif({ quality: FORMAT_QUALITY.avif, effort: 6 }).toBuffer();
    case 'png':
      return image.png({ compressionLevel: 9, palette: false }).toBuffer();
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

async function processImageRenditions(imageBuffer: Buffer): Promise<ProcessedRendition[]> {
  const results: ProcessedRendition[] = [];

  const metadata = await sharp(imageBuffer).metadata();
  const originalWidth = metadata.width || 832;
  const originalHeight = metadata.height || 1248;

  // Process each size
  for (const size of SESSION_SIZES) {
    const { width, height } = RENDITION_SIZES[size];

    // Skip if target is larger than original
    if (width > originalWidth || height > originalHeight) {
      continue;
    }

    const resized = sharp(imageBuffer).resize(width, height, {
      fit: 'cover',
      position: 'center',
    });

    for (const format of FORMATS_TO_GENERATE) {
      const processed = await convertToFormat(resized.clone(), format);
      results.push({ size, format, buffer: processed, width, height });
    }
  }

  // Original in webp/avif
  for (const format of FORMATS_TO_GENERATE) {
    const processed = await convertToFormat(sharp(imageBuffer), format);
    results.push({
      size: 'original',
      format,
      buffer: processed,
      width: originalWidth,
      height: originalHeight,
    });
  }

  // Original PNG (archive copy)
  results.push({
    size: 'original',
    format: 'png',
    buffer: imageBuffer,
    width: originalWidth,
    height: originalHeight,
  });

  return results;
}

function groupRenditions(
  renditions: ProcessedRendition[],
  keyPrefix: string,
  urlBuilder: (s3Key: string) => string
): ImageRenditions {
  const grouped: ImageRenditions = {};

  for (const r of renditions) {
    const s3Key = getRenditionS3Key(keyPrefix, r.size, r.format);
    const file: RenditionFile = {
      s3Key,
      url: urlBuilder(s3Key),
      sizeBytes: r.buffer.length,
      format: r.format,
      width: r.width,
      height: r.height,
    };

    const sizeKey = r.size as keyof ImageRenditions;
    if (!grouped[sizeKey]) {
      grouped[sizeKey] = {};
    }
    (grouped[sizeKey] as Record<string, RenditionFile>)[r.format] = file;
  }

  return grouped;
}

// ============================================================================
// S3 Client
// ============================================================================

function createS3(): S3Client {
  const config: ConstructorParameters<typeof S3Client>[0] = {
    region: AWS_REGION,
  };

  if (process.env.AWS_ENDPOINT_URL) {
    config.endpoint = process.env.AWS_ENDPOINT_URL;
    config.forcePathStyle = true;
  }

  return new S3Client(config);
}

async function downloadFromS3(
  s3: S3Client,
  bucket: string,
  key: string
): Promise<Buffer> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  if (!response.Body) {
    throw new Error(`Empty response body for S3 key: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function uploadRendition(
  s3: S3Client,
  bucket: string,
  s3Key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'max-age=31536000', // 1 year
    })
  );
}

function buildMediaUrl(key: string): string {
  if (S3_CDN_URL) {
    return `${S3_CDN_URL}/${key}`;
  }
  return `https://${S3_MEDIA_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

// ============================================================================
// Database
// ============================================================================

function createDb(): postgres.Sql {
  return postgres(DATABASE_URL, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}

async function fetchImagesWithoutRenditions(
  sql: postgres.Sql,
  limit: number,
  excludeIds: string[]
): Promise<CompanionImageRow[]> {
  if (excludeIds.length > 0) {
    return sql<CompanionImageRow[]>`
      SELECT id, s3_key, user_id, session_id, cache_key, companion_id, width, height, size_bytes
      FROM companion_images
      WHERE renditions IS NULL
        AND id != ALL(${excludeIds})
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  }

  return sql<CompanionImageRow[]>`
    SELECT id, s3_key, user_id, session_id, cache_key, companion_id, width, height, size_bytes
    FROM companion_images
    WHERE renditions IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

async function countImagesWithoutRenditions(sql: postgres.Sql): Promise<number> {
  const result = await sql`
    SELECT count(*)::int as count
    FROM companion_images
    WHERE renditions IS NULL
  `;
  return result[0].count;
}

async function updateImageRenditions(
  sql: postgres.Sql,
  imageId: string,
  renditions: ImageRenditions
): Promise<void> {
  await sql`
    UPDATE companion_images
    SET renditions = ${JSON.stringify(renditions)}::jsonb
    WHERE id = ${imageId}
      AND renditions IS NULL
  `;
}

// ============================================================================
// Progress Tracking
// ============================================================================

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    console.warn('Could not load progress file, starting fresh');
  }

  return {
    completed: [],
    failed: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalProcessed: 0,
    totalBytesSaved: 0,
  };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function clearProgress(): void {
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

// ============================================================================
// Core Processing
// ============================================================================

async function processOneImage(
  s3: S3Client,
  sql: postgres.Sql,
  image: CompanionImageRow,
  dryRun: boolean
): Promise<{ success: boolean; bytesSaved: number }> {
  const keyPrefix = getRenditionKeyPrefix(image.user_id, image.session_id, image.cache_key);

  if (dryRun) {
    console.log(`  [DRY RUN] Would process: ${image.id} (${image.s3_key})`);
    console.log(`    → renditions under: ${keyPrefix}/`);
    return { success: true, bytesSaved: 0 };
  }

  // 1. Download original from S3
  const originalBuffer = await downloadFromS3(s3, S3_MEDIA_BUCKET, image.s3_key);
  const originalSize = originalBuffer.length;

  // 2. Process renditions (all sizes for session images)
  const renditions = await processImageRenditions(originalBuffer);

  // 3. Upload all renditions to S3
  for (const r of renditions) {
    const s3Key = getRenditionS3Key(keyPrefix, r.size, r.format);
    const contentType = FORMAT_CONTENT_TYPE[r.format];
    await uploadRendition(s3, S3_MEDIA_BUCKET, s3Key, r.buffer, contentType);
  }

  // 4. Group into structured object and update DB
  const groupedRenditions = groupRenditions(renditions, keyPrefix, buildMediaUrl);

  // 5. Update database (idempotent - only updates if renditions IS NULL)
  await updateImageRenditions(sql, image.id, groupedRenditions);

  // Calculate savings
  let bytesSaved = 0;
  for (const r of renditions) {
    if (r.size !== 'original') {
      bytesSaved += originalSize - r.buffer.length;
    }
  }

  return { success: true, bytesSaved: Math.max(0, bytesSaved) };
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  return {
    resume: args.includes('--resume'),
    dryRun: args.includes('--dry-run'),
    batchSize: parseInt(
      args.find((a) => a.startsWith('--batch-size='))?.split('=')[1] || String(DEFAULT_BATCH_SIZE),
      10
    ),
    concurrency: parseInt(
      args.find((a) => a.startsWith('--concurrent='))?.split('=')[1] || String(DEFAULT_CONCURRENCY),
      10
    ),
    limit: (() => {
      const val = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
      return val ? parseInt(val, 10) : null;
    })(),
    clean: args.includes('--clean'),
  };
}

function printUsage(): void {
  console.log(`
Backfill Image Renditions
=========================

Generates WebP/AVIF renditions at multiple sizes for existing companion images
that only have full-size PNGs.

Usage:
  npx tsx scripts/backfill-image-renditions.ts [options]

Options:
  --resume          Resume from previous progress file
  --dry-run         Preview what would be processed (no S3/DB changes)
  --batch-size=N    Number of images to fetch per batch (default: ${DEFAULT_BATCH_SIZE})
  --concurrent=N    Max parallel image processing (default: ${DEFAULT_CONCURRENCY})
  --limit=N         Process at most N images total
  --clean           Clear progress file and exit

Environment:
  DATABASE_URL      PostgreSQL connection string
  AWS_REGION        AWS region (default: us-east-1)
  S3_MEDIA_BUCKET   S3 bucket name (default: campfire-dev-media)
  S3_CDN_URL        Optional CDN URL prefix
`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const args = parseArgs();

  if (args.clean) {
    clearProgress();
    console.log('Cleared progress file.');
    process.exit(0);
  }

  console.log('\n=== Backfill Image Renditions ===');
  console.log(`Batch size: ${args.batchSize}`);
  console.log(`Concurrency: ${args.concurrency}`);
  if (args.limit) console.log(`Limit: ${args.limit} images`);
  if (args.dryRun) console.log('Mode: DRY RUN');
  if (args.resume) console.log('Mode: RESUME');
  console.log('');

  const sql = createDb();
  const s3 = createS3();
  const progress = args.resume ? loadProgress() : {
    completed: [],
    failed: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalProcessed: 0,
    totalBytesSaved: 0,
  };

  try {
    // Count total work
    const totalPending = await countImagesWithoutRenditions(sql);
    console.log(`Images without renditions: ${totalPending}`);
    if (progress.completed.length > 0) {
      console.log(`Previously completed: ${progress.completed.length}`);
    }
    console.log('');

    if (totalPending === 0) {
      console.log('All images already have renditions. Nothing to do.');
      return;
    }

    const startTime = Date.now();
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalBytesSaved = 0;
    const maxToProcess = args.limit ?? Infinity;

    // Process in batches
    while (totalProcessed < maxToProcess) {
      const remaining = Math.min(args.batchSize, maxToProcess - totalProcessed);

      // Fetch next batch, excluding already-completed IDs
      const batch = await fetchImagesWithoutRenditions(sql, remaining, progress.completed);

      if (batch.length === 0) {
        console.log('\nNo more images to process.');
        break;
      }

      console.log(`\nBatch: ${batch.length} images (${totalProcessed + 1}-${totalProcessed + batch.length})`);

      // Process batch with concurrency limit
      for (let i = 0; i < batch.length; i += args.concurrency) {
        const chunk = batch.slice(i, i + args.concurrency);
        await Promise.allSettled(
          chunk.map(async (image) => {
            try {
              const result = await processOneImage(s3, sql, image, args.dryRun);
              if (result.success) {
                progress.completed.push(image.id);
                totalSuccess++;
                totalBytesSaved += result.bytesSaved;
                console.log(`  ✓ ${image.id} (saved ${formatBytes(result.bytesSaved)})`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              progress.failed.push(image.id);
              totalFailed++;
              console.error(`  ✗ ${image.id}: ${msg}`);
            }
          })
        );

        totalProcessed += chunk.length;

        // Save progress after each concurrent chunk
        if (!args.dryRun) {
          progress.totalProcessed = totalSuccess + totalFailed;
          progress.totalBytesSaved = totalBytesSaved;
          saveProgress(progress);
        }
      }

      // Brief pause between batches
      if (!args.dryRun) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n=== Backfill Complete ===');
    console.log(`Processed: ${totalProcessed}`);
    console.log(`Success: ${totalSuccess}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`Bytes saved: ${formatBytes(totalBytesSaved)}`);
    console.log(`Time: ${elapsed}s`);

    if (totalFailed > 0) {
      console.log(`\n${totalFailed} images failed. Run with --resume to retry.`);
    }
  } finally {
    await sql.end();
    s3.destroy();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
