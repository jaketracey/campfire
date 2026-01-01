/**
 * Debug API
 * Admin debug endpoints for session introspection.
 */

import { get } from './client';

export interface TurnMetrics {
  id: string;
  turnNumber: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  createdAt: string;
  userMessageLength: number;
  agentMessageLength: number;
}

export interface EventInfo {
  type: string;
  timestamp: string;
  turnId: string | null;
  payload: Record<string, unknown>;
}

export interface EntityTypeCount {
  entityType: string;
  count: number;
}

export interface RelationTypeInfo {
  relationType: string;
  count: number;
  avgConfidence: number;
}

export interface SessionDebugInfo {
  session: {
    id: string;
    companionId: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    turnCount: number;
    lastActivityAt: string | null;
  };
  metrics: {
    totalTurns: number;
    avgLatencyMs: number;
    totalLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: string;
  };
  turns: TurnMetrics[];
  events: {
    recent: EventInfo[];
    typeCounts: Record<string, number>;
    totalCount: number;
  };
  knowledgeGraph: {
    entityCount: number;
    edgeCount: number;
    entityTypes: EntityTypeCount[];
    relationTypes: RelationTypeInfo[];
  };
}

export interface KGSummaryResponse {
  summary: string;
  stats: {
    entityCount: number;
    edgeCount: number;
    entityTypes: EntityTypeCount[];
    relationTypes: RelationTypeInfo[];
    sampleEntities: Array<{
      name: string;
      type: string;
      aliases: string[];
    }>;
    sampleEdges: Array<{
      source: string;
      relation: string;
      target: string;
      confidence: number;
    }>;
  };
  llmError?: string;
}

export interface ContextDebugInfo {
  maxContextTurns: number;
  currentContextTurns: number;
  estimatedContextTokens: number;
  turns: Array<{
    turnNumber: number;
    userMessage: string | null;
    agentMessage: string | null;
    createdAt: string;
  }>;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Get comprehensive debug info for a session
 */
export async function getSessionDebugInfo(
  sessionId: string
): Promise<SessionDebugInfo> {
  const response = await get<ApiResponse<SessionDebugInfo>>(
    `/debug/sessions/${sessionId}`
  );
  return response.data;
}

/**
 * Get LLM-generated knowledge graph summary
 */
export async function getKGSummary(
  sessionId: string
): Promise<KGSummaryResponse> {
  const response = await get<ApiResponse<KGSummaryResponse>>(
    `/debug/sessions/${sessionId}/kg-summary`
  );
  return response.data;
}

/**
 * Get context that would be sent to LLM
 */
export async function getContextDebugInfo(
  sessionId: string
): Promise<ContextDebugInfo> {
  const response = await get<ApiResponse<ContextDebugInfo>>(
    `/debug/sessions/${sessionId}/context`
  );
  return response.data;
}
