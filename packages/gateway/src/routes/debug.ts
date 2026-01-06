/**
 * Debug Routes
 * Admin-only debug endpoints for session introspection.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { getKnowledgeGraphRepository } from '../repositories/knowledge-graph.js';
import { getEventStore } from '../db/event-store.js';
import { logger } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import { renderPromptFromDb } from '../services/prompt-runtime.js';

// Orchestrator base URL for LLM calls
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] || 'http://localhost:8000';

/**
 * Register debug routes
 */
export async function debugRoutes(app: FastifyInstance): Promise<void> {
  const sessionRepo = getSessionsRepository();
  const kgRepo = getKnowledgeGraphRepository();
  const eventStore = getEventStore();

  /**
   * GET /debug/sessions/:sessionId - Get comprehensive debug info for a session
   */
  app.get(
    '/sessions/:sessionId',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return withSpan('debug.getSessionDebug', async (span) => {
        const { sessionId } = request.params as { sessionId: string };
        const user = request.user!;
        span.setAttributes({ 'session.id': sessionId, 'user.id': user.userId });

        // Get session with stats
        const session = await sessionRepo.findByIdWithStats(sessionId);
        if (!session) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Session not found' },
          });
        }

        // Verify ownership
        if (session.user_id !== user.userId) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied' },
          });
        }

        // Get turns with detailed metrics
        const turnsResult = await sessionRepo.listTurns({
          sessionId,
          limit: 100,
          offset: 0,
        });

        // Calculate aggregate metrics from turns
        const turns = turnsResult.data;
        const totalLatency = turns.reduce((sum, t) => sum + (t.latency_ms || 0), 0);
        const totalInputTokens = turns.reduce((sum, t) => sum + (t.token_count_input || 0), 0);
        const totalOutputTokens = turns.reduce((sum, t) => sum + (t.token_count_output || 0), 0);
        const totalCost = turns.reduce((sum, t) => sum + parseFloat(String(t.cost_usd || 0)), 0);

        // Get recent events for this session
        const events = await eventStore.query({
          userId: user.userId,
          sessionId,
          limit: 50,
          order: 'desc',
        });

        // Count events by type
        const eventTypeCounts: Record<string, number> = {};
        for (const event of events) {
          eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
        }

        // Get KG stats for this user/companion
        const [entityCount, edgeCount, entityTypes, relationTypes] = await Promise.all([
          kgRepo.countEntities(user.userId, session.companion_id),
          kgRepo.countEdges(user.userId, session.companion_id),
          kgRepo.getEntityTypes(user.userId, session.companion_id),
          kgRepo.getRelationTypes(user.userId, session.companion_id),
        ]);

        logger.debug({ sessionId, userId: user.userId }, 'Debug info retrieved');

        return reply.send({
          success: true,
          data: {
            session: {
              id: session.id,
              companionId: session.companion_id,
              status: session.status,
              startedAt: session.started_at,
              endedAt: session.ended_at,
              turnCount: session.turnCount,
              lastActivityAt: null, // Not included in SessionWithStats currently
            },
            metrics: {
              totalTurns: turns.length,
              avgLatencyMs: turns.length > 0 ? Math.round(totalLatency / turns.length) : 0,
              totalLatencyMs: totalLatency,
              totalInputTokens,
              totalOutputTokens,
              totalTokens: totalInputTokens + totalOutputTokens,
              totalCostUsd: totalCost.toFixed(6),
            },
            turns: turns.map((t) => ({
              id: t.id,
              turnNumber: t.turn_number,
              latencyMs: t.latency_ms,
              inputTokens: t.token_count_input,
              outputTokens: t.token_count_output,
              costUsd: t.cost_usd,
              createdAt: t.created_at,
              userMessageLength: t.user_message?.length || 0,
              agentMessageLength: t.agent_message?.length || 0,
            })),
            events: {
              recent: events.slice(0, 20).map((e) => ({
                type: e.type,
                timestamp: e.timestamp,
                turnId: e.turnId,
                payload: e.payload,
              })),
              typeCounts: eventTypeCounts,
              totalCount: events.length,
            },
            knowledgeGraph: {
              entityCount,
              edgeCount,
              entityTypes,
              relationTypes: relationTypes.slice(0, 10),
            },
          },
        });
      });
    }
  );

  /**
   * GET /debug/sessions/:sessionId/kg-summary - Get LLM-generated KG summary
   */
  app.get(
    '/sessions/:sessionId/kg-summary',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return withSpan('debug.getKGSummary', async (span) => {
        const { sessionId } = request.params as { sessionId: string };
        const user = request.user!;
        span.setAttributes({ 'session.id': sessionId, 'user.id': user.userId });

        // Get session
        const session = await sessionRepo.findByIdWithStats(sessionId);
        if (!session) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Session not found' },
          });
        }

        // Verify ownership
        if (session.user_id !== user.userId) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied' },
          });
        }

        // Get KG data
        const [entities, edges, entityTypes, relationTypes] = await Promise.all([
          kgRepo.listEntities(user.userId, { companionId: session.companion_id, limit: 50 }),
          kgRepo.listEdges(user.userId, { companionId: session.companion_id, limit: 100, status: 'active' }),
          kgRepo.getEntityTypes(user.userId, session.companion_id),
          kgRepo.getRelationTypes(user.userId, session.companion_id),
        ]);

        // Build a structured summary for the LLM
        const kgData = {
          entityCount: entities.data.length,
          edgeCount: edges.data.length,
          entityTypes,
          relationTypes,
          sampleEntities: entities.data.slice(0, 20).map((e) => ({
            name: e.name,
            type: e.entity_type,
            aliases: e.aliases,
          })),
          sampleEdges: edges.data.slice(0, 30).map((e) => {
            const sourceEntity = entities.data.find((ent) => ent.id === e.source_entity_id);
            const targetEntity = entities.data.find((ent) => ent.id === e.target_entity_id);
            return {
              source: sourceEntity?.name || e.source_entity_id.slice(0, 8),
              relation: e.relation_type,
              target: targetEntity?.name || e.target_entity_id.slice(0, 8),
              confidence: e.confidence,
            };
          }),
        };

        // If no KG data, return empty summary
        if (kgData.entityCount === 0 && kgData.edgeCount === 0) {
          return reply.send({
            success: true,
            data: {
              summary: 'No knowledge graph data exists for this user yet. As conversations progress, entities and relationships will be extracted and stored.',
              stats: kgData,
            },
          });
        }

        const { rendered: systemPrompt } = await renderPromptFromDb({
          key: 'gateway.debug_kg_system_prompt',
          variables: {},
        });

        const sampleEntitiesBullets = kgData.sampleEntities.length > 0
          ? kgData.sampleEntities.map((e) => `- ${e.name} (${e.type})`).join('\n')
          : '- (none)';

        const sampleEdgesBullets = kgData.sampleEdges.length > 0
          ? kgData.sampleEdges.map((e) => `- ${e.source} --[${e.relation}]--> ${e.target} (confidence: ${e.confidence.toFixed(2)})`).join('\n')
          : '- (none)';

        const { rendered: userPrompt } = await renderPromptFromDb({
          key: 'gateway.debug_kg_user_prompt',
          variables: {
            entity_count: kgData.entityCount,
            edge_count: kgData.edgeCount,
            entity_types_json: JSON.stringify(kgData.entityTypes),
            relation_types_json: JSON.stringify(kgData.relationTypes),
            sample_entities_bullets: sampleEntitiesBullets,
            sample_edges_bullets: sampleEdgesBullets,
          },
        });

        try {
          const response = await fetch(`${ORCHESTRATOR_URL}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: 'debug-kg-summary',
              user_id: user.userId,
                companion_spec: {
                  id: 'system',
                  name: 'KG Analyst',
                  description: 'Knowledge graph analysis assistant',
                  personality_traits: ['analytical', 'concise'],
                  communication_style: 'professional',
                  voice_id: null,
                  avatar_url: null,
                  system_prompt: systemPrompt,
                  safety_level: 'standard',
                  allowed_tools: [],
                  max_context_turns: 1,
                  temperature: 0.3,
                  version: 1,
                },
              user_message: userPrompt,
              recent_turns: [],
              session_summary: null,
              long_term_memories: null,
            }),
          });

          if (!response.ok) {
            throw new Error(`Orchestrator request failed: ${response.status}`);
          }

          // Parse SSE stream
          let summary = '';
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          if (reader) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data !== '[DONE]' && !data.startsWith('[ERROR]')) {
                      summary += data;
                    }
                  }
                }
              }
            } finally {
              reader.releaseLock();
            }
          }

          logger.info({ sessionId, userId: user.userId, summaryLength: summary.length }, 'KG summary generated');

          return reply.send({
            success: true,
            data: {
              summary,
              stats: kgData,
            },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error({ err: error, sessionId }, 'Failed to generate KG summary');
          return reply.status(502).send({
            success: false,
            error: 'Failed to generate KG summary',
            details: errorMessage,
            stats: kgData,
          });
        }
      });
    }
  );

  /**
   * GET /debug/sessions/:sessionId/context - Get the context that would be sent to the LLM
   */
  app.get(
    '/sessions/:sessionId/context',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return withSpan('debug.getContext', async (span) => {
        const { sessionId } = request.params as { sessionId: string };
        const user = request.user!;
        span.setAttributes({ 'session.id': sessionId, 'user.id': user.userId });

        // Get session
        const session = await sessionRepo.findByIdWithStats(sessionId);
        if (!session) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Session not found' },
          });
        }

        // Verify ownership
        if (session.user_id !== user.userId) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied' },
          });
        }

        // Get recent turns (what would be sent as context)
        const recentTurns = await sessionRepo.listTurns({
          sessionId,
          limit: 20,
          offset: 0,
        });

        // Calculate context token estimate
        let totalContextChars = 0;
        const contextTurns = recentTurns.data.map((t) => {
          const userLen = t.user_message?.length || 0;
          const agentLen = t.agent_message?.length || 0;
          totalContextChars += userLen + agentLen;
          return {
            turnNumber: t.turn_number,
            userMessage: t.user_message,
            agentMessage: t.agent_message,
            createdAt: t.created_at,
          };
        });

        const estimatedTokens = Math.ceil(totalContextChars / 4);

        return reply.send({
          success: true,
          data: {
            maxContextTurns: 20,
            currentContextTurns: contextTurns.length,
            estimatedContextTokens: estimatedTokens,
            turns: contextTurns,
          },
        });
      });
    }
  );
}
