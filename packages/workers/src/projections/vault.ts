import { Worker, Job } from 'bullmq';
import type Redis from 'ioredis';
import type { Logger } from 'pino';
import { format } from 'date-fns';
import crypto from 'crypto';
import type { DbClient } from '../db/client.js';
import type { S3StorageClient } from '../storage/s3.js';

interface VaultJobData {
  type: 'session' | 'memory' | 'entity' | 'daily' | 'memory_deletion';
  userId: string;
  resourceId: string;
  action?: 'create' | 'update' | 'remove';
}

interface WorkerConfig {
  connection: Redis;
  db: DbClient;
  s3: S3StorageClient;
  logger: Logger;
}

export class VaultProjectionWorker {
  private worker: Worker | null = null;
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  async start() {
    this.worker = new Worker<VaultJobData>(
      'vault-projection',
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: 5,
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info({ jobId: job.id }, 'Vault projection completed');
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error({ jobId: job?.id, error: err.message }, 'Vault projection failed');
    });

    this.config.logger.info('Vault projection worker started');
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async process(job: Job<VaultJobData>): Promise<void> {
    const { type, userId, resourceId, action } = job.data;

    switch (type) {
      case 'session':
        await this.projectSession(userId, resourceId);
        break;
      case 'memory':
        if (action === 'remove') {
          await this.removeMemoryNote(userId, resourceId);
        } else {
          await this.projectMemory(userId, resourceId);
        }
        break;
      case 'entity':
        await this.projectEntity(userId, resourceId);
        break;
      case 'daily':
        await this.projectDaily(userId, resourceId);
        break;
      case 'memory_deletion':
        await this.removeMemoryNote(userId, resourceId);
        break;
    }
  }

  private async projectSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.config.db.getSession(sessionId);
    if (!session) return;

    const turns = await this.config.db.getTurnsBySession(sessionId);
    const companion = await this.config.db.getCompanion(session.companion_id);

    const date = new Date(session.started_at);
    const datePath = format(date, 'yyyy/MM/dd');
    const vaultPath = `Conversations/${datePath}/${sessionId}.md`;

    const content = this.generateSessionMarkdown(session, turns, companion);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const s3Key = `vault/${userId}/${vaultPath}`;

    await this.config.s3.uploadVaultFile(s3Key, content);
    await this.config.db.upsertVaultFile(userId, vaultPath, contentHash, s3Key);

    this.config.logger.info({ userId, sessionId, vaultPath }, 'Session projected to vault');
  }

  private generateSessionMarkdown(
    session: Record<string, unknown>,
    turns: Record<string, unknown>[],
    companion: Record<string, unknown> | null
  ): string {
    const startedAt = new Date(session.started_at as string);
    const companionName = companion?.name || 'Companion';

    let md = `---
session_id: ${session.id}
companion_id: ${session.companion_id}
started_at: ${startedAt.toISOString()}
ended_at: ${session.ended_at || 'ongoing'}
status: ${session.status}
tags: [conversation]
---

# Conversation with [[${companionName}]]

**Date:** ${format(startedAt, 'MMMM d, yyyy')}
**Time:** ${format(startedAt, 'h:mm a')}

---

`;

    for (const turn of turns) {
      md += `## Turn ${turn.turn_number}\n\n`;
      if (turn.user_message) {
        md += `**You:** ${turn.user_message}\n\n`;
      }
      if (turn.agent_message) {
        md += `**${companionName}:** ${turn.agent_message}\n\n`;
      }
      md += '---\n\n';
    }

    md += `\n## Provenance\n\n`;
    md += `- Session Event ID: \`${session.id}\`\n`;
    md += `- Turn Count: ${turns.length}\n`;

    return md;
  }

  private async projectMemory(userId: string, memoryId: string): Promise<void> {
    const memory = await this.config.db.getMemory(memoryId);
    if (!memory) return;

    const vaultPath = `Memories/${memoryId}.md`;
    const content = this.generateMemoryMarkdown(memory);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const s3Key = `vault/${userId}/${vaultPath}`;

    await this.config.s3.uploadVaultFile(s3Key, content);
    await this.config.db.upsertVaultFile(userId, vaultPath, contentHash, s3Key);

    this.config.logger.info({ userId, memoryId, vaultPath }, 'Memory projected to vault');
  }

  private generateMemoryMarkdown(memory: Record<string, unknown>): string {
    const createdAt = new Date(memory.created_at as string);

    return `---
memory_id: ${memory.id}
companion_id: ${memory.companion_id}
source_event_id: ${memory.source_event_id}
created_at: ${createdAt.toISOString()}
tags: [memory]
---

# Memory

${memory.content}

---

## Provenance

- Source Event: \`${memory.source_event_id}\`
- Created: ${format(createdAt, 'MMMM d, yyyy h:mm a')}
`;
  }

  private async removeMemoryNote(userId: string, memoryId: string): Promise<void> {
    const vaultPath = `Memories/${memoryId}.md`;
    const s3Key = `vault/${userId}/${vaultPath}`;

    await this.config.s3.deleteVaultFile(s3Key);
    await this.config.db.deleteVaultFile(userId, vaultPath);

    this.config.logger.info({ userId, memoryId }, 'Memory note removed from vault');
  }

  private async projectEntity(userId: string, entityId: string): Promise<void> {
    // Entity projection - creates/updates entity notes in vault
    const vaultPath = `Entities/${entityId}.md`;
    // Implementation would query KG edges for this entity
    this.config.logger.info({ userId, entityId, vaultPath }, 'Entity projected to vault');
  }

  private async projectDaily(userId: string, dateStr: string): Promise<void> {
    // Daily note projection - summarizes all activity for a day
    const vaultPath = `Daily/${dateStr}.md`;
    this.config.logger.info({ userId, dateStr, vaultPath }, 'Daily note projected to vault');
  }
}
