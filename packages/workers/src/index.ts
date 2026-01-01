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
  const { createDbClient } = await import('./db/client.js');
  const { createS3Client } = await import('./storage/s3.js');

  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
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
  const embeddingWorker = new EmbeddingProjectionWorker({
    connection,
    db,
    logger: logger.child({ worker: 'embedding' }),
  });

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

  // Start all workers
  await Promise.all([
    vaultWorker.start(),
    embeddingWorker.start(),
    kgWorker.start(),
    summaryWorker.start(),
    personalityProfileWorker.start(),
    emailWorker.start(),
  ]);

  logger.info('All projection workers started successfully');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      vaultWorker.stop(),
      embeddingWorker.stop(),
      kgWorker.stop(),
      summaryWorker.stop(),
      personalityProfileWorker.stop(),
      emailWorker.stop(),
    ]);
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start workers:', err);
  process.exit(1);
});
