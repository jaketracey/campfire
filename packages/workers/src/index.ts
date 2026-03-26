import './load-env.js';

// Dynamic import to ensure env vars are loaded first
async function bootstrap() {
  const { Worker: _Worker } = await import('bullmq');
  const Redis = (await import('ioredis')).default;
  const pino = (await import('pino')).default;
  const { env } = await import('./env.js');
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
  const { InfluencerSampleGenerationWorker } = await import('./influencer/worker.js');
  const { AdSpendSyncWorker, LtvCalculationWorker, createAdSpendSyncQueue, createLtvCalculationQueue } = await import('./ads/index.js');
  const { MemoryDecayWorker, MemoryExpirationWorker, createMemoryDecayQueue, createMemoryExpirationQueue } = await import('./memory/index.js');
  const { ProactiveOutreachWorker, createProactiveOutreachQueue } = await import('./proactive/index.js');
  const { MessagingInboundWorker } = await import('./messaging/index.js');
  const { createDbClient } = await import('./db/client.js');
  const { createS3Client } = await import('./storage/s3.js');
  const { createHealthServer } = await import('./health.js');

  const logger = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    }),
  });

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const db = createDbClient(env.DATABASE_URL);
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
  if (env.OPENAI_API_KEY) {
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
    rateLimitPerSecond: env.SES_MAX_SEND_RATE,
  });

  // Image rendition worker - generates optimized image sizes/formats
  const imageRenditionWorker = new ImageRenditionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'image-rendition' }),
    concurrency: 1, // CPU-intensive, limit concurrency further to reduce load
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

  // Influencer sample generation worker - generates LoRA test samples via FAL
  const influencerSampleGenerationWorker = new InfluencerSampleGenerationWorker({
    connection,
    db,
    logger: logger.child({ worker: 'influencer-sample-generation' }),
    concurrency: 2,
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

  // Memory decay worker - reduces importance of stale memories
  const memoryDecayWorker = new MemoryDecayWorker({
    connection,
    db,
    logger: logger.child({ worker: 'memory-decay' }),
    concurrency: 1,
  });

  // Messaging inbound worker - processes messages from external platforms
  const messagingInboundWorker = new MessagingInboundWorker({
    connection,
    db,
    logger: logger.child({ worker: 'messaging-inbound' }),
    concurrency: 5, // Multiple messages can process in parallel
  });

  // Memory expiration worker - soft-deletes expired memories
  const memoryExpirationWorker = new MemoryExpirationWorker({
    connection,
    db,
    logger: logger.child({ worker: 'memory-expiration' }),
    concurrency: 1,
  });

  // Proactive outreach worker - evaluates and sends companion check-ins
  const proactiveOutreachWorker = new ProactiveOutreachWorker({
    connection,
    db,
    logger: logger.child({ worker: 'proactive-outreach' }),
    orchestratorUrl: env.ORCHESTRATOR_URL,
    internalServiceKey: process.env.INTERNAL_SERVICE_KEY || 'dev-internal-service-key',
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3002',
    concurrency: 1,
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
    influencerSampleGenerationWorker.start(),
    adSpendSyncWorker.start(),
    ltvCalculationWorker.start(),
    memoryDecayWorker.start(),
    memoryExpirationWorker.start(),
    proactiveOutreachWorker.start(),
    messagingInboundWorker.start(),
  ].filter(Boolean));

  logger.info('All projection workers started successfully');

  // Start health check HTTP server
  const workerNames = [
    'vault', 'knowledge-graph', 'summary', 'personality-profile',
    'email', 'image-rendition', 'video-generation', 'gift-generation',
    'influencer-sample-generation', 'ad-spend-sync', 'ltv-calculation',
    'memory-decay', 'memory-expiration', 'proactive-outreach', 'messaging-inbound',
    ...(embeddingWorker ? ['embedding'] : []),
  ];
  const healthServer = createHealthServer({
    redis: connection,
    db,
    logger: logger.child({ component: 'health' }),
    port: env.HEALTH_PORT,
    workerNames,
  });

  // Set up scheduled jobs for ad spend sync and LTV calculation
  await setupScheduledJobs(connection, logger);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    healthServer.close();
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
      influencerSampleGenerationWorker.stop(),
      adSpendSyncWorker.stop(),
      ltvCalculationWorker.stop(),
      memoryDecayWorker.stop(),
      memoryExpirationWorker.stop(),
      proactiveOutreachWorker.stop(),
      messagingInboundWorker.stop(),
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
    const memoryDecayQueue = createMemoryDecayQueue(redisConnection);
    const memoryExpirationQueue = createMemoryExpirationQueue(redisConnection);
    const proactiveOutreachQueue = createProactiveOutreachQueue(redisConnection);

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

    // Schedule daily memory decay at 3 AM UTC
    // Reduces importance of memories not accessed in 7+ days
    await memoryDecayQueue.upsertJobScheduler(
      'daily-memory-decay',
      {
        pattern: '0 3 * * *', // 3:00 AM UTC daily
        tz: 'UTC',
      },
      {
        name: 'daily-memory-decay',
        data: {}, // Empty data = decay all active user-companion pairs
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        },
      }
    );
    log.info('Scheduled daily memory decay at 3 AM UTC');

    // Schedule hourly memory expiration
    // Soft-deletes memories past their expires_at date
    await memoryExpirationQueue.upsertJobScheduler(
      'hourly-memory-expiration',
      {
        pattern: '0 * * * *', // Every hour at :00
        tz: 'UTC',
      },
      {
        name: 'hourly-memory-expiration',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 15000 },
        },
      }
    );
    log.info('Scheduled hourly memory expiration');

    // Schedule proactive outreach evaluation every 30 minutes
    // Evaluates all active user-companion pairs for check-in opportunities
    await proactiveOutreachQueue.upsertJobScheduler(
      'periodic-proactive-outreach',
      {
        pattern: '*/30 * * * *', // Every 30 minutes
        tz: 'UTC',
      },
      {
        name: 'periodic-proactive-outreach',
        data: {}, // Empty data = evaluate all active pairs
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
        },
      }
    );
    log.info('Scheduled proactive outreach evaluation every 30 minutes');
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start workers:', err);
  process.exit(1);
});
