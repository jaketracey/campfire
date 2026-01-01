import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import OpenAI from 'openai';
import type { DbClient } from '../db/client.js';

interface EmbeddingJobData {
  type: 'create' | 'delete';
  memoryId: string;
  userId: string;
  content?: string;
}

interface WorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
}

export class EmbeddingProjectionWorker {
  private worker: Worker | null = null;
  private config: WorkerConfig;
  private openai: OpenAI;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async start() {
    this.worker = new Worker<EmbeddingJobData>(
      'embedding-projection',
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: 10,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info({ jobId: job.id }, 'Embedding projection completed');
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Embedding projection failed'
      );
    });

    this.config.logger.info('Embedding projection worker started');
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async process(job: Job<EmbeddingJobData>): Promise<void> {
    const { type, memoryId, userId, content } = job.data;

    switch (type) {
      case 'create':
        if (content) {
          await this.createEmbedding(userId, memoryId, content);
        }
        break;
      case 'delete':
        await this.deleteEmbedding(userId, memoryId);
        break;
    }
  }

  private async createEmbedding(
    userId: string,
    memoryId: string,
    content: string
  ): Promise<void> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: content,
        dimensions: 1536,
      });

      const embedding = response.data[0].embedding;

      // Store embedding in pgvector
      await this.config.db.sql`
        UPDATE memories
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${memoryId}
      `;

      this.config.logger.info(
        { userId, memoryId },
        'Embedding created and stored'
      );
    } catch (error) {
      this.config.logger.error(
        { userId, memoryId, error },
        'Failed to create embedding'
      );
      throw error;
    }
  }

  private async deleteEmbedding(userId: string, memoryId: string): Promise<void> {
    // When a memory is deleted, the embedding is automatically removed
    // as it's stored in the same row
    await this.config.db.deleteMemory(memoryId);

    this.config.logger.info({ userId, memoryId }, 'Embedding deleted with memory');
  }

  async searchSimilar(
    userId: string,
    companionId: string,
    query: string,
    limit = 5
  ): Promise<Array<{ id: string; content: string; similarity: number }>> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 1536,
    });

    const queryEmbedding = response.data[0].embedding;

    const results = await this.config.db.sql`
      SELECT id, content, 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
      FROM memories
      WHERE user_id = ${userId} AND companion_id = ${companionId}
      ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
      LIMIT ${limit}
    `;

    return results.map((row) => ({
      id: row.id as string,
      content: row.content as string,
      similarity: row.similarity as number,
    }));
  }
}
