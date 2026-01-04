import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from monorepo root (3 levels up from src/)
dotenv.config({ path: resolve(__dirname, '../../../.env') });

// Dynamic import to ensure env vars are loaded first
async function bootstrap() {
  const { Worker: _Worker } = await import('bullmq');
  const Redis = (await import('ioredis')).default;
  const pino = (await import('pino')).default;
  const { VaultProjectionWorker } = await import('./projections/vault.js');
  const { EmbeddingProjectionWorker } = await import('./projections/embeddings.js');
  const { KnowledgeGraphProjectionWorker } = await import('./projections/knowledge-graph.js');
  const { SummaryProjectionWorker } = await import('./projections/summary.js');
  const { PersonalityProfileProjectionWorker } = await import('./projections/personality-profile.js');
  const { EmailProjectionWorker } = await import('./email/worker.js');
  const { getEmailService } = await import('./email/service.js');
  const { ImageRenditionWorker } = await import('./image/worker.js');
  const { VideoGenerationWorker } = await import('./video/worker.js');
  const { GiftGenerationWorker } = await import('./gift/worker.js');
  const { AdSpendSyncWorker, LtvCalculationWorker, createAdSpendSyncQueue, createLtvCalculationQueue } = await import('./ads/index.js');
  const { createDbClient } = await import('./db/client.js');
  const { createS3Client } = await import('./storage/s3.js');

  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    }),
  });

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const db = createDbClient(process.env.DATABASE_URL!);
  const s3 = createS3Client();

  logger.info('Starting Campfire projection workers...');

  // Vault projection worker - generates Obsidian-style markdown files
  const vaultWorker = new VaultProjectionWorker({
    connection,
    db,
    s3,
    logger: logger.child({ worker: 'vault' }),
  });

  // Embedding projection worker - generates and stores vector embeddings
  // Skip if no OpenAI API key (for stealth/self-hosted deployments)
  let embeddingWorker: InstanceType<typeof EmbeddingProjectionWorker> | null = null;
  if (process.env.OPENAI_API_KEY) {
    embeddingWorker = new EmbeddingProjectionWorker({
      connection,
      db,
      logger: logger.child({ worker: 'embedding' }),
    });
  } else {
    logger.warn('OPENAI_API_KEY not set, skipping embedding worker');
  }

  // Knowledge graph projection worker - maintains KG edges
  const kgWorker = new KnowledgeGraphProjectionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'kg' }),
  });

  // Summary projection worker - generates session summaries
  const summaryWorker = new SummaryProjectionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'summary' }),
  });

  // Personality profile projection worker - analyzes user personality from chats
  const personalityProfileWorker = new PersonalityProfileProjectionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'personality-profile' }),
  });

  // Initialize email service (needed by email worker)
  getEmailService({
    connection,
    db,
    logger: logger.child({ service: 'email' }),
  });

  // Email worker - processes email queue
  const emailWorker = new EmailProjectionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'email' }),
    concurrency: 5,
    rateLimitPerSecond: parseInt(process.env.SES_MAX_SEND_RATE || '14'),
  });

  // Image rendition worker - generates optimized image sizes/formats
  const imageRenditionWorker = new ImageRenditionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'image-rendition' }),
    concurrency: 2, // CPU-intensive, limit concurrency
  });

  // Video generation worker - processes video requests via AnimateDiff
  const videoGenerationWorker = new VideoGenerationWorker({
    connection,
    db,
    logger: logger.child({ worker: 'video-generation' }),
    concurrency: 1, // GPU-intensive, limit to one at a time
  });

  // Gift generation worker - generates gift content and images
  const giftGenerationWorker = new GiftGenerationWorker({
    connection,
    db,
    logger: logger.child({ worker: 'gift-generation' }),
    concurrency: 2, // LLM + imagegen, moderate concurrency
  });

  // Ad spend sync worker - syncs spend data from Google/Facebook Ads
  const adSpendSyncWorker = new AdSpendSyncWorker({
    connection,
    db,
    logger: logger.child({ worker: 'ad-spend-sync' }),
    concurrency: 2,
  });

  // LTV calculation worker - calculates user lifetime value
  const ltvCalculationWorker = new LtvCalculationWorker({
    connection,
    db,
    logger: logger.child({ worker: 'ltv-calculation' }),
    concurrency: 3,
    batchSize: 100,
  });

  // Start all workers
  await Promise.all([
    vaultWorker.start(),
    embeddingWorker?.start(),
    kgWorker.start(),
    summaryWorker.start(),
    personalityProfileWorker.start(),
    emailWorker.start(),
    imageRenditionWorker.start(),
    videoGenerationWorker.start(),
    giftGenerationWorker.start(),
    adSpendSyncWorker.start(),
    ltvCalculationWorker.start(),
  ].filter(Boolean));

  logger.info('All projection workers started successfully');

  // Set up scheduled jobs for ad spend sync and LTV calculation
  await setupScheduledJobs(connection, logger);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      vaultWorker.stop(),
      embeddingWorker?.stop(),
      kgWorker.stop(),
      summaryWorker.stop(),
      personalityProfileWorker.stop(),
      emailWorker.stop(),
      imageRenditionWorker.stop(),
      videoGenerationWorker.stop(),
      giftGenerationWorker.stop(),
      adSpendSyncWorker.stop(),
      ltvCalculationWorker.stop(),
    ].filter(Boolean));
    await connection.quit();
    process.exit(0);
  };

  /**
   * Set up scheduled jobs using BullMQ repeatable jobs.
   * - Ad Spend Sync: Daily at 6 AM UTC
   * - LTV Calculation: Daily at 7 AM UTC
   */
  async function setupScheduledJobs(redisConnection: typeof connection, log: typeof logger) {
    const adSpendQueue = createAdSpendSyncQueue(redisConnection);
    const ltvQueue = createLtvCalculationQueue(redisConnection);

    // Schedule daily ad spend sync at 6 AM UTC
    // Syncs yesterday's data from all active ad accounts
    await adSpendQueue.upsertJobScheduler(
      'daily-ad-spend-sync',
      {
        pattern: '0 6 * * *', // 6:00 AM UTC daily
        tz: 'UTC',
      },
      {
        name: 'daily-ad-spend-sync',
        data: {}, // Empty data = sync all active accounts for yesterday
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      }
    );
    log.info('Scheduled daily ad spend sync at 6 AM UTC');

    // Schedule daily LTV calculation at 7 AM UTC
    // Recalculates LTV for all users with payments
    await ltvQueue.upsertJobScheduler(
      'daily-ltv-calculation',
      {
        pattern: '0 7 * * *', // 7:00 AM UTC daily
        tz: 'UTC',
      },
      {
        name: 'daily-ltv-calculation',
        data: {}, // Empty data = calculate for all users
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        },
      }
    );
    log.info('Scheduled daily LTV calculation at 7 AM UTC');
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start workers:', err);
  process.exit(1);
});
