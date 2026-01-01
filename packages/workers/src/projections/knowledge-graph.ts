import { Worker, Job } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';

interface KgJobData {
  type: 'propose' | 'add' | 'remove' | 'cascade_delete';
  userId: string;
  companionId: string;
  edge?: {
    id: string;
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
    confidence: number;
    sourceEventId: string;
  };
  edgeId?: string;
  memoryId?: string;
}

interface WorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
}

export class KnowledgeGraphProjectionWorker {
  private worker: Worker | null = null;
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  async start() {
    this.worker = new Worker<KgJobData>(
      'kg-projection',
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: 5,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info({ jobId: job.id }, 'KG projection completed');
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error({ jobId: job?.id, error: err.message }, 'KG projection failed');
    });

    this.config.logger.info('Knowledge graph projection worker started');
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async process(job: Job<KgJobData>): Promise<void> {
    const { type, userId, companionId, edge, edgeId, memoryId } = job.data;

    switch (type) {
      case 'propose':
        if (edge) {
          await this.proposeEdge(userId, companionId, edge);
        }
        break;
      case 'add':
        if (edge) {
          await this.addEdge(userId, companionId, edge);
        }
        break;
      case 'remove':
        if (edgeId) {
          await this.removeEdge(userId, edgeId);
        }
        break;
      case 'cascade_delete':
        if (memoryId) {
          await this.cascadeDeleteFromMemory(userId, memoryId);
        }
        break;
    }
  }

  private async proposeEdge(
    userId: string,
    companionId: string,
    edge: NonNullable<KgJobData['edge']>
  ): Promise<void> {
    // Ensure entities exist
    await this.ensureEntity(userId, companionId, edge.sourceEntity);
    await this.ensureEntity(userId, companionId, edge.targetEntity);

    // Check for existing similar edges (deduplication)
    const existing = await this.config.db.sql`
      SELECT id FROM kg_edges
      WHERE source_entity_id = ${edge.sourceEntity}
        AND target_entity_id = ${edge.targetEntity}
        AND relation_type = ${edge.relationType}
        AND status = 'active'
    `;

    if (existing.length > 0) {
      // Update existing edge's confidence and last_seen
      await this.config.db.sql`
        UPDATE kg_edges
        SET confidence = GREATEST(confidence, ${edge.confidence}),
            last_seen = NOW()
        WHERE id = ${existing[0].id}
      `;
      this.config.logger.info(
        { userId, edgeId: existing[0].id },
        'Updated existing KG edge'
      );
      return;
    }

    // Insert as proposed
    await this.config.db.upsertKgEdge({
      id: edge.id,
      sourceEntityId: edge.sourceEntity,
      targetEntityId: edge.targetEntity,
      relationType: edge.relationType,
      confidence: edge.confidence,
      sourceEventId: edge.sourceEventId,
      status: 'proposed',
    });

    this.config.logger.info({ userId, edgeId: edge.id }, 'KG edge proposed');
  }

  private async addEdge(
    userId: string,
    companionId: string,
    edge: NonNullable<KgJobData['edge']>
  ): Promise<void> {
    await this.ensureEntity(userId, companionId, edge.sourceEntity);
    await this.ensureEntity(userId, companionId, edge.targetEntity);

    await this.config.db.upsertKgEdge({
      id: edge.id,
      sourceEntityId: edge.sourceEntity,
      targetEntityId: edge.targetEntity,
      relationType: edge.relationType,
      confidence: edge.confidence,
      sourceEventId: edge.sourceEventId,
      status: 'active',
    });

    this.config.logger.info({ userId, edgeId: edge.id }, 'KG edge added');
  }

  private async removeEdge(userId: string, edgeId: string): Promise<void> {
    await this.config.db.removeKgEdge(edgeId);
    this.config.logger.info({ userId, edgeId }, 'KG edge removed');
  }

  private async cascadeDeleteFromMemory(userId: string, memoryId: string): Promise<void> {
    // Find all edges that reference this memory as their source
    const edges = await this.config.db.sql`
      SELECT id FROM kg_edges
      WHERE source_event_id IN (
        SELECT event_id FROM events
        WHERE payload->>'memory_id' = ${memoryId}
      )
    `;

    for (const edge of edges) {
      await this.config.db.removeKgEdge(edge.id as string);
    }

    this.config.logger.info(
      { userId, memoryId, edgesRemoved: edges.length },
      'KG edges cascade deleted from memory'
    );
  }

  private async ensureEntity(
    userId: string,
    companionId: string,
    entityId: string
  ): Promise<void> {
    await this.config.db.sql`
      INSERT INTO kg_entities (id, user_id, companion_id, name, type, metadata)
      VALUES (${entityId}, ${userId}, ${companionId}, ${entityId}, 'unknown', '{}')
      ON CONFLICT (id) DO NOTHING
    `;
  }
}
