import postgres from 'postgres';
import type { CampfireEvent } from '@campfire/shared';

export function createDbClient(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    sql,

    async appendEvent(event: CampfireEvent): Promise<void> {
      await sql`
        INSERT INTO events (
          event_id, timestamp, user_id, session_id, turn_id, trace_id,
          type, payload, version, causation_id, correlation_id, cost
        ) VALUES (
          ${event.event_id}, ${event.timestamp}, ${event.user_id},
          ${event.session_id}, ${event.turn_id}, ${event.trace_id},
          ${event.type}, ${JSON.stringify(event.payload)}, ${event.version},
          ${event.causation_id}, ${event.correlation_id}, ${JSON.stringify(event.cost)}
        )
        ON CONFLICT (event_id) DO NOTHING
      `;
    },

    async getEventsBySession(sessionId: string): Promise<CampfireEvent[]> {
      const rows = await sql`
        SELECT * FROM events WHERE session_id = ${sessionId} ORDER BY timestamp
      `;
      return rows as unknown as CampfireEvent[];
    },

    async getEventsByUser(userId: string, limit = 100): Promise<CampfireEvent[]> {
      const rows = await sql`
        SELECT * FROM events WHERE user_id = ${userId}
        ORDER BY timestamp DESC LIMIT ${limit}
      `;
      return rows as unknown as CampfireEvent[];
    },

    async getEventsByType(type: string, since?: Date): Promise<CampfireEvent[]> {
      if (since) {
        const rows = await sql`
          SELECT * FROM events WHERE type = ${type} AND timestamp > ${since.toISOString()}
          ORDER BY timestamp
        `;
        return rows as unknown as CampfireEvent[];
      }
      const rows = await sql`
        SELECT * FROM events WHERE type = ${type} ORDER BY timestamp
      `;
      return rows as unknown as CampfireEvent[];
    },

    async getMemory(memoryId: string) {
      const [row] = await sql`
        SELECT * FROM memories WHERE id = ${memoryId}
      `;
      return row;
    },

    async deleteMemory(memoryId: string): Promise<void> {
      await sql`DELETE FROM memories WHERE id = ${memoryId}`;
    },

    async getSession(sessionId: string) {
      const [row] = await sql`
        SELECT * FROM sessions WHERE id = ${sessionId}
      `;
      return row;
    },

    async getTurnsBySession(sessionId: string) {
      const rows = await sql`
        SELECT * FROM turns WHERE session_id = ${sessionId} ORDER BY turn_number
      `;
      return rows;
    },

    async getCompanion(companionId: string) {
      const [row] = await sql`
        SELECT * FROM companions WHERE id = ${companionId}
      `;
      return row;
    },

    async upsertVaultFile(
      userId: string,
      path: string,
      contentHash: string,
      s3Key: string
    ): Promise<void> {
      await sql`
        INSERT INTO vault_files (user_id, path, content_hash, s3_key, updated_at)
        VALUES (${userId}, ${path}, ${contentHash}, ${s3Key}, NOW())
        ON CONFLICT (user_id, path)
        DO UPDATE SET content_hash = ${contentHash}, s3_key = ${s3Key}, updated_at = NOW()
      `;
    },

    async deleteVaultFile(userId: string, path: string): Promise<void> {
      await sql`DELETE FROM vault_files WHERE user_id = ${userId} AND path = ${path}`;
    },

    async upsertKgEdge(edge: {
      id: string;
      userId: string;
      companionId: string;
      sourceEntityId: string;
      targetEntityId: string;
      relationType: string;
      confidence: number;
      sourceEventId: string;
      status: string;
    }): Promise<void> {
      await sql`
        INSERT INTO kg_edges (
          id, user_id, companion_id, source_entity_id, target_entity_id, relation_type,
          confidence, source_event_id, first_seen, last_seen, status
        ) VALUES (
          ${edge.id}, ${edge.userId}, ${edge.companionId}, ${edge.sourceEntityId}, ${edge.targetEntityId},
          ${edge.relationType}, ${edge.confidence}, ${edge.sourceEventId},
          NOW(), NOW(), ${edge.status}
        )
        ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO UPDATE SET
          last_seen = NOW(),
          confidence = GREATEST(kg_edges.confidence, ${edge.confidence}),
          mention_count = kg_edges.mention_count + 1,
          status = ${edge.status}
      `;
    },

    async removeKgEdge(edgeId: string): Promise<void> {
      await sql`
        UPDATE kg_edges SET status = 'removed', last_seen = NOW()
        WHERE id = ${edgeId}
      `;
    },

    async close(): Promise<void> {
      await sql.end();
    },
  };
}

export type DbClient = ReturnType<typeof createDbClient>;
