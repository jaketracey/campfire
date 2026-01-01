import { Worker, Job } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';

interface EntityData {
  id: string;
  name: string;
  type: string;
}

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
  entities?: EntityData[];
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
    const { type, userId, companionId, edge, entities, edgeId, memoryId } = job.data;

    switch (type) {
      case 'propose':
        if (edge) {
          await this.proposeEdge(userId, companionId, edge, entities);
        }
        break;
      case 'add':
        if (edge) {
          await this.addEdge(userId, companionId, edge, entities);
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
    edge: NonNullable<KgJobData['edge']>,
    entities?: EntityData[]
  ): Promise<void> {
    // Ensure entities exist with proper names and get their actual IDs
    const sourceEntity = entities?.find(e => e.id === edge.sourceEntity);
    const targetEntity = entities?.find(e => e.id === edge.targetEntity);

    const sourceEntityId = await this.ensureEntityWithData(userId, companionId, edge.sourceEntity, sourceEntity);
    const targetEntityId = await this.ensureEntityWithData(userId, companionId, edge.targetEntity, targetEntity);

    // Check for existing similar edges (deduplication)
    // Note: Don't filter by status since unique constraint is on (source, target, relation) without status
    const existing = await this.config.db.sql`
      SELECT id, status FROM kg_edges
      WHERE source_entity_id = ${sourceEntityId}
        AND target_entity_id = ${targetEntityId}
        AND relation_type = ${edge.relationType}
    `;

    const existingEdge = existing[0];
    if (existingEdge) {
      // Update existing edge's confidence and last_seen
      await this.config.db.sql`
        UPDATE kg_edges
        SET confidence = GREATEST(confidence, ${edge.confidence}),
            last_seen = NOW(),
            mention_count = mention_count + 1
        WHERE id = ${existingEdge.id}
      `;
      this.config.logger.info(
        { userId, edgeId: existingEdge.id, existingStatus: existingEdge.status },
        'Updated existing KG edge'
      );
      return;
    }

    // Insert as proposed
    await this.config.db.upsertKgEdge({
      id: edge.id,
      userId,
      companionId,
      sourceEntityId,
      targetEntityId,
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
    edge: NonNullable<KgJobData['edge']>,
    entities?: EntityData[]
  ): Promise<void> {
    const sourceEntity = entities?.find(e => e.id === edge.sourceEntity);
    const targetEntity = entities?.find(e => e.id === edge.targetEntity);

    const sourceEntityId = await this.ensureEntityWithData(userId, companionId, edge.sourceEntity, sourceEntity);
    const targetEntityId = await this.ensureEntityWithData(userId, companionId, edge.targetEntity, targetEntity);

    await this.config.db.upsertKgEdge({
      id: edge.id,
      userId,
      companionId,
      sourceEntityId,
      targetEntityId,
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
    const canonicalName = entityId.toLowerCase().trim();
    await this.config.db.sql`
      INSERT INTO kg_entities (id, user_id, companion_id, name, canonical_name, entity_type, metadata)
      VALUES (${entityId}, ${userId}, ${companionId}, ${entityId}, ${canonicalName}, 'unknown', '{}')
      ON CONFLICT (user_id, companion_id, canonical_name) DO NOTHING
    `;
  }

  private async ensureEntityWithData(
    userId: string,
    companionId: string,
    entityId: string,
    entityData?: EntityData
  ): Promise<string> {
    const name = entityData?.name || entityId;
    const entityType = entityData?.type || 'unknown';
    const canonicalName = name.toLowerCase().trim();

    // Use RETURNING to get the actual entity ID (handles both insert and update)
    const result = await this.config.db.sql`
      INSERT INTO kg_entities (id, user_id, companion_id, name, canonical_name, entity_type, metadata)
      VALUES (${entityId}, ${userId}, ${companionId}, ${name}, ${canonicalName}, ${entityType}, '{}')
      ON CONFLICT (user_id, companion_id, canonical_name) DO UPDATE SET
        name = EXCLUDED.name,
        entity_type = EXCLUDED.entity_type,
        updated_at = NOW()
      RETURNING id
    `;

    const actualId = result[0]?.id as string || entityId;

    this.config.logger.debug(
      { name, userId, entityId: actualId, entityType },
      'Entity ensured'
    );

    return actualId;
  }
}
