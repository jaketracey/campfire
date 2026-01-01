/**
 * WebSocket Handler
 * Real-time bidirectional communication for voice and chat.
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { logger } from '../observability/logger.js';
import { verifyToken, type AuthenticatedUser } from '../middleware/auth.js';
import {
  getCompanionsService,
  getSessionsService,
  getEventsService,
  getVoiceService,
  type EventContext,
} from '../services/index.js';
import { getKnowledgeGraphRepository } from '../repositories/index.js';
import { enqueueSummaryJob } from '../utils/queue.js';

// Orchestrator base URL
const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] || 'http://localhost:8000';

/**
 * WebSocket message types
 */
export type WSMessageType =
  | 'ping'
  | 'pong'
  | 'auth'
  | 'auth_success'
  | 'auth_error'
  | 'session_start'
  | 'session_started'
  | 'session_end'
  | 'session_ended'
  | 'user_message'
  | 'agent_message'
  | 'agent_message_chunk'
  | 'agent_message_end'
  | 'audio_chunk'
  | 'audio_end'
  | 'transcription'
  | 'voice_enabled'
  | 'voice_start'
  | 'voice_audio_chunk'
  | 'voice_end'
  | 'voice_transcription'
  | 'tts_audio_chunk'
  | 'tts_audio_end'
  | 'tool_call'
  | 'tool_result'
  | 'error';

/**
 * WebSocket message structure
 */
export interface WSMessage<T = unknown> {
  type: WSMessageType;
  id: string;
  timestamp: string;
  payload: T;
}

/**
 * Connected client state
 */
interface ConnectedClient {
  id: string;
  ws: WebSocket;
  user?: AuthenticatedUser;
  sessionId?: string;
  companionId?: string;
  authenticated: boolean;
  connectedAt: Date;
  lastPing: Date;
  voiceEnabled: boolean;
  voiceTranscription: string;
}

// Active connections
const clients = new Map<string, ConnectedClient>();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 60000;

/**
 * Register WebSocket handler
 */
export async function registerWebSocketHandler(app: FastifyInstance): Promise<void> {
  // Start heartbeat checker
  const heartbeatInterval = setInterval(checkHeartbeats, HEARTBEAT_INTERVAL);

  // Cleanup on server close
  app.addHook('onClose', async () => {
    clearInterval(heartbeatInterval);
    for (const client of clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    clients.clear();
  });

  // WebSocket route
  app.get('/ws', { websocket: true }, (socket, request) => {
    const clientId = nanoid();
    const client: ConnectedClient = {
      id: clientId,
      ws: socket,
      authenticated: false,
      connectedAt: new Date(),
      lastPing: new Date(),
      voiceEnabled: false,
      voiceTranscription: '',
    };

    clients.set(clientId, client);

    logger.info(
      { clientId, ip: request.ip },
      'WebSocket client connected'
    );

    // Handle incoming messages
    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        await handleMessage(client, message);
      } catch (error) {
        logger.error({ err: error, clientId }, 'Failed to handle WebSocket message');
        sendError(client, 'Invalid message format');
      }
    });

    // Handle close
    socket.on('close', (code, reason) => {
      logger.info(
        { clientId, code, reason: reason.toString() },
        'WebSocket client disconnected'
      );
      clients.delete(clientId);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error({ err: error, clientId }, 'WebSocket error');
    });

    // Send connection acknowledgment
    send(client, {
      type: 'ping',
      payload: { clientId },
    });
  });
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(client: ConnectedClient, message: WSMessage): Promise<void> {
  client.lastPing = new Date();

  switch (message.type) {
    case 'ping':
      send(client, { type: 'pong', payload: {} });
      break;

    case 'pong':
      // Just update lastPing (already done above)
      break;

    case 'auth':
      await handleAuth(client, message.payload as { token: string });
      break;

    case 'session_start':
      await handleSessionStart(client, message.payload as { companionId: string });
      break;

    case 'session_end':
      await handleSessionEnd(client);
      break;

    case 'user_message':
      await handleUserMessage(client, message.payload as { content: string });
      break;

    case 'audio_chunk':
      await handleAudioChunk(client, message.payload as { data: string; sequence: number });
      break;

    case 'audio_end':
      await handleAudioEnd(client);
      break;

    case 'voice_enabled':
      await handleVoiceEnabled(client, message.payload as { enabled: boolean });
      break;

    case 'voice_start':
      await handleVoiceStart(client);
      break;

    case 'voice_audio_chunk':
      await handleVoiceAudioChunk(client, message.payload as { data: string });
      break;

    case 'voice_end':
      await handleVoiceEnd(client);
      break;

    default:
      sendError(client, `Unknown message type: ${message.type}`);
  }
}

/**
 * Handle authentication message
 */
async function handleAuth(client: ConnectedClient, payload: { token: string }): Promise<void> {
  const tokenPayload = await verifyToken(payload.token);

  if (!tokenPayload) {
    send(client, {
      type: 'auth_error',
      payload: { message: 'Invalid or expired token' },
    });
    return;
  }

  client.user = {
    userId: tokenPayload.userId,
    email: tokenPayload.email,
    role: tokenPayload.role,
  };
  client.authenticated = true;

  logger.info({ clientId: client.id, userId: client.user.userId }, 'WebSocket client authenticated');

  send(client, {
    type: 'auth_success',
    payload: { userId: client.user.userId },
  });
}

/**
 * Handle session start
 * Supports both creating new sessions (companionId) and resuming existing sessions (sessionId)
 */
async function handleSessionStart(
  client: ConnectedClient,
  payload: { companionId?: string; sessionId?: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  try {
    const sessionsService = getSessionsService();
    const companionsService = getCompanionsService();

    let sessionId: string;
    let companionId: string;

    if (payload.sessionId) {
      // Resume existing session
      const session = await sessionsService.getById(client.user.userId, payload.sessionId);
      if (!session) {
        sendError(client, 'Session not found');
        return;
      }

      sessionId = session.id;
      companionId = session.companion_id;

      logger.info(
        { clientId: client.id, sessionId, companionId },
        'Resuming existing session'
      );
    } else if (payload.companionId) {
      // Create new session
      const companion = await companionsService.getById(client.user.userId, payload.companionId);
      if (!companion) {
        sendError(client, 'Companion not found');
        return;
      }

      const session = await sessionsService.start(client.user.userId, {
        companionId: payload.companionId,
      });

      sessionId = session.id;
      companionId = payload.companionId;

      logger.info(
        { clientId: client.id, sessionId, companionId },
        'Session started'
      );
    } else {
      sendError(client, 'Either companionId or sessionId is required');
      return;
    }

    client.sessionId = sessionId;
    client.companionId = companionId;

    send(client, {
      type: 'session_started',
      payload: { sessionId, companionId },
    });
  } catch (error) {
    logger.error({ err: error, clientId: client.id }, 'Failed to start session');
    sendError(client, error instanceof Error ? error.message : 'Failed to start session');
  }
}

/**
 * Handle session end
 */
async function handleSessionEnd(client: ConnectedClient): Promise<void> {
  if (!client.sessionId || !client.user) {
    sendError(client, 'No active session');
    return;
  }

  try {
    const sessionsService = getSessionsService();
    const sessionId = client.sessionId;

    await sessionsService.end(client.user.userId, sessionId, {
      reason: 'user_ended',
    });

    client.sessionId = undefined;
    client.companionId = undefined;

    logger.info({ clientId: client.id, sessionId }, 'Session ended');

    send(client, {
      type: 'session_ended',
      payload: { sessionId },
    });
  } catch (error) {
    logger.error({ err: error, clientId: client.id }, 'Failed to end session');
    sendError(client, error instanceof Error ? error.message : 'Failed to end session');
  }
}

/**
 * Handle user message (text)
 */
async function handleUserMessage(
  client: ConnectedClient,
  payload: { content: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  const startTime = Date.now();
  const userId = client.user.userId;
  const sessionId = client.sessionId;
  const companionId = client.companionId;

  logger.debug(
    { clientId: client.id, sessionId, contentLength: payload.content.length },
    'User message received'
  );

  try {
    const companionsService = getCompanionsService();
    const sessionsService = getSessionsService();
    const eventsService = getEventsService();

    // 1. Get companion details for building the spec
    const companion = await companionsService.getById(userId, companionId);
    if (!companion) {
      sendError(client, 'Companion not found');
      return;
    }

    // 2. Create event context
    const eventContext: EventContext = {
      userId,
      sessionId,
      traceId: crypto.randomUUID(),
    };

    // 3. Emit user message event
    await eventsService.emitUserMessage(eventContext, {
      content: payload.content,
      messageType: 'text',
    });

    // 4. Create turn in database (with user message)
    const turn = await sessionsService.addTurn(userId, sessionId, {
      userMessage: payload.content,
      userMessageType: 'text',
    });

    // 5. Build CompanionSpec for orchestrator
    const spec = companion.spec;
    const companionSpec = {
      id: companion.id,
      name: companion.name,
      description: (spec?.identity as Record<string, unknown> | undefined)?.['selfDescription'] as string | undefined
        || `An AI companion named ${companion.name}`,
      personality_traits: spec?.personality?.traits
        ? Object.entries(spec.personality.traits)
            .filter(([_, v]) => (v as number) > 0.5)
            .map(([k]) => k)
        : ['friendly', 'helpful'],
      communication_style: spec?.personality?.archetype || 'friendly and supportive',
      voice_id: spec?.voice?.voice_id || null,
      avatar_url: null,
      system_prompt: buildSystemPrompt(companion as unknown as { name: string; spec: Record<string, unknown> | null }),
      safety_level: spec?.boundaries?.content_rating === 'G' ? 'strict' : 'standard',
      allowed_tools: [],
      max_context_turns: 20,
      temperature: 0.7,
      version: companion.spec_version,
    };

    // 6. Fetch companion self-knowledge from KG
    const selfKnowledge = await fetchCompanionSelfKnowledge(userId, companionId, companion.name);

    // 7. Get recent turns for context (match max_context_turns in companion spec)
    const recentTurns = await sessionsService.getRecentTurns(userId, sessionId, 20);

    const formattedTurns = recentTurns
      .filter(t => t.id !== turn.id) // Exclude current turn
      .filter(t => t.user_message && t.agent_message) // Only include COMPLETE turns
      .map(t => ({
        id: t.id,
        session_id: sessionId,
        user_message: {
          id: crypto.randomUUID(),
          role: 'user' as const,
          content: t.user_message || '',
          created_at: t.created_at.toISOString(),
        },
        assistant_message: t.agent_message ? {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: t.agent_message,
          created_at: t.created_at.toISOString(),
        } : null,
        tool_calls: [],
        tool_results: [],
        metadata: {
          turn_id: t.id,
          session_id: sessionId,
          user_id: userId,
          companion_id: companionId,
          model_used: 'claude-3-5-sonnet-20241022',
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          latency_ms: t.latency_ms || 0,
          cost_usd: 0,
          tools_invoked: [],
          safety_flags: [],
          prompt_version: '1.0.0',
          policy_version: '1.0.0',
        },
        created_at: t.created_at.toISOString(),
      }));

    // 8. Fetch session summary for context retention
    const sessionSummary = await sessionsService.getContextSummary(userId, sessionId, companionId);

    // 9. Call orchestrator streaming endpoint
    const orchestratorRequest = {
      session_id: sessionId,
      user_id: userId,
      companion_spec: companionSpec,
      user_message: payload.content,
      recent_turns: formattedTurns,
      session_summary: sessionSummary,
      long_term_memories: null,
      companion_self_knowledge: selfKnowledge.length > 0 ? selfKnowledge : null,
    };

    logger.debug(
      { sessionId, companionId, orchestratorUrl: `${ORCHESTRATOR_URL}/stream` },
      'Calling orchestrator'
    );

    const response = await fetch(`${ORCHESTRATOR_URL}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orchestratorRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Orchestrator request failed');
      sendError(client, 'Failed to get response from AI');
      return;
    }

    // 8. Stream SSE response to WebSocket client
    let fullContent = '';
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      sendError(client, 'Failed to read response stream');
      return;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE format: "data: {content}\n\n"
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              // Stream complete
              continue;
            }

            if (data.startsWith('[ERROR]')) {
              logger.error({ error: data }, 'Orchestrator stream error');
              sendError(client, 'AI processing error');
              return;
            }

            // Send chunk to client
            fullContent += data;
            send(client, {
              type: 'agent_message_chunk',
              payload: { content: data },
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 9. Calculate metrics
    const latencyMs = Date.now() - startTime;
    const estimatedInputTokens = Math.ceil(payload.content.length / 4);
    const estimatedOutputTokens = Math.ceil(fullContent.length / 4);
    const estimatedCostUsd = (estimatedInputTokens * 0.003 + estimatedOutputTokens * 0.015) / 1000;

    // 10. Complete the turn in database
    const completedTurn = await sessionsService.completeTurn(
      userId,
      sessionId,
      turn.id,
      fullContent,
      'text',
      {
        latencyMs,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        costUsd: estimatedCostUsd,
      }
    );

    // 10a. Trigger summary generation every 10 turns for context retention
    if (completedTurn.turn_number % 10 === 0) {
      enqueueSummaryJob(userId, companionId, sessionId).catch(err => {
        logger.warn({ err, sessionId }, 'Failed to enqueue summary job');
      });
    }

    // 11. Send completion message
    send(client, {
      type: 'agent_message_end',
      payload: {
        content: fullContent,
        sessionId,
        turnId: turn.id,
      },
    });

    // 12. If voice is enabled, synthesize TTS for the response
    if (client.voiceEnabled && fullContent) {
      const voiceConfig = companion.spec?.voice as { voice_id?: string; settings?: Record<string, unknown> } | undefined;
      const voiceId = voiceConfig?.voice_id;

      if (voiceId) {
        const voiceSettings = voiceConfig?.settings || {};
        await sendTTSForResponse(client, fullContent, voiceId, {
          stability: typeof voiceSettings.stability === 'number' ? voiceSettings.stability : undefined,
          similarityBoost: typeof voiceSettings.similarity_boost === 'number' ? voiceSettings.similarity_boost : undefined,
          style: typeof voiceSettings.style === 'number' ? voiceSettings.style : undefined,
          useSpeakerBoost: typeof voiceSettings.use_speaker_boost === 'boolean' ? voiceSettings.use_speaker_boost : undefined,
        });
      } else {
        logger.warn({ companionId }, 'Voice enabled but no voice_id configured for companion');
      }
    }

    logger.info(
      { sessionId, turnId: turn.id, latencyMs, contentLength: fullContent.length },
      'Message processed successfully'
    );
  } catch (error) {
    logger.error({ err: error, clientId: client.id, sessionId }, 'Failed to process message');
    sendError(client, error instanceof Error ? error.message : 'Failed to process message');
  }
}

/**
 * Build a system prompt from companion spec
 */
function buildSystemPrompt(companion: { name: string; spec: Record<string, unknown> | null }): string {
  const spec = companion.spec || {};
  const identity = spec.identity as Record<string, string> | undefined;
  const personality = spec.personality as Record<string, unknown> | undefined;
  const boundaries = spec.boundaries as Record<string, unknown> | undefined;

  const parts: string[] = [
    `You are ${companion.name}, an AI companion.`,
  ];

  if (identity?.backstory) {
    parts.push(`Background: ${identity.backstory}`);
  }

  if (identity?.pronouns) {
    parts.push(`Use ${identity.pronouns} pronouns when referring to yourself.`);
  }

  if (personality?.archetype) {
    parts.push(`Personality archetype: ${personality.archetype}`);
  }

  if (personality?.traits && typeof personality.traits === 'object') {
    const traitDescriptions = Object.entries(personality.traits as Record<string, number>)
      .filter(([_, value]) => value > 0.5)
      .map(([trait, value]) => `${trait} (${Math.round(value * 100)}%)`)
      .join(', ');
    if (traitDescriptions) {
      parts.push(`Key traits: ${traitDescriptions}`);
    }
  }

  if (boundaries?.content_rating) {
    parts.push(`Content rating: ${boundaries.content_rating}`);
  }

  parts.push('');
  parts.push('Be conversational, warm, and engaging. Listen actively and respond thoughtfully.');

  return parts.join('\n');
}

/**
 * Companion self-knowledge entry from Knowledge Graph
 */
interface CompanionSelfKnowledge {
  category: 'backstory' | 'trait' | 'quirk' | 'experience' | 'motivation' | 'relationship';
  content: string;
  confidence: number;
}

/**
 * Fetch companion's self-knowledge from the Knowledge Graph
 * This retrieves the companion's own entity and all its outgoing relationships
 * (backstory, traits, quirks, experiences, motivations)
 */
async function fetchCompanionSelfKnowledge(
  userId: string,
  companionId: string,
  companionName: string
): Promise<CompanionSelfKnowledge[]> {
  try {
    const kgRepo = getKnowledgeGraphRepository();

    // Find the companion's own entity in the KG
    // The companion entity is typically stored with the companion's name as canonical_name
    const companionEntity = await kgRepo.findEntityByCanonicalName(
      userId,
      companionId,
      companionName.toLowerCase()
    );

    if (!companionEntity) {
      logger.debug(
        { userId, companionId, companionName },
        'No KG entity found for companion'
      );
      return [];
    }

    // Get all outgoing edges from the companion entity
    // These represent things the companion "has", "experienced", "wants", etc.
    const edges = await kgRepo.getOutgoingEdges(companionEntity.id, { status: 'active' });

    if (edges.length === 0) {
      return [];
    }

    // Fetch target entities for each edge to get the actual content
    const selfKnowledge: CompanionSelfKnowledge[] = [];

    for (const edge of edges) {
      const targetEntity = await kgRepo.findEntityById(edge.target_entity_id);
      if (!targetEntity) continue;

      // Map relation types to categories
      let category: CompanionSelfKnowledge['category'] = 'trait';
      const relationType = edge.relation_type.toLowerCase();

      if (relationType === 'has_backstory' || targetEntity.name.toLowerCase().includes('backstory')) {
        category = 'backstory';
      } else if (relationType === 'experienced' || relationType === 'has_experience') {
        category = 'experience';
      } else if (relationType === 'wants' || relationType === 'desires' || relationType === 'motivated_by') {
        category = 'motivation';
      } else if (relationType === 'has_quirk' || targetEntity.entity_type === 'quirk') {
        category = 'quirk';
      } else if (relationType === 'knows' || relationType === 'related_to') {
        category = 'relationship';
      } else {
        category = 'trait';
      }

      selfKnowledge.push({
        category,
        content: targetEntity.name,
        confidence: edge.confidence,
      });
    }

    logger.debug(
      { userId, companionId, count: selfKnowledge.length },
      'Fetched companion self-knowledge from KG'
    );

    return selfKnowledge;
  } catch (error) {
    logger.error(
      { err: error, userId, companionId },
      'Failed to fetch companion self-knowledge'
    );
    return [];
  }
}

/**
 * Handle audio chunk (voice input)
 */
async function handleAudioChunk(
  client: ConnectedClient,
  payload: { data: string; sequence: number }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  // TODO: Forward audio to transcription service
  logger.debug(
    { clientId: client.id, sequence: payload.sequence, dataLength: payload.data.length },
    'Audio chunk received'
  );
}

/**
 * Handle audio end (voice input complete)
 */
async function handleAudioEnd(client: ConnectedClient): Promise<void> {
  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  // TODO: Signal transcription service to finalize
  logger.debug({ clientId: client.id, sessionId: client.sessionId }, 'Audio stream ended');
}

/**
 * Handle voice enabled/disabled
 */
async function handleVoiceEnabled(
  client: ConnectedClient,
  payload: { enabled: boolean }
): Promise<void> {
  if (!client.authenticated) {
    sendError(client, 'Authentication required');
    return;
  }

  client.voiceEnabled = payload.enabled;
  logger.info({ clientId: client.id, voiceEnabled: payload.enabled }, 'Voice mode updated');
}

/**
 * Handle voice start (push-to-talk begins)
 */
async function handleVoiceStart(client: ConnectedClient): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  const voiceService = getVoiceService();

  // Clear any previous transcription
  client.voiceTranscription = '';

  // Start STT session
  const success = await voiceService.startSTTSession(
    client.id,
    (text: string, isFinal: boolean) => {
      // Accumulate transcription
      if (isFinal) {
        client.voiceTranscription += text + ' ';
      }

      // Send transcription to client for display
      send(client, {
        type: 'voice_transcription',
        payload: { text, isFinal },
      });
    },
    (error: string) => {
      sendError(client, `Voice error: ${error}`);
    }
  );

  if (!success) {
    sendError(client, 'Failed to start voice session');
  }

  logger.debug({ clientId: client.id }, 'Voice recording started');
}

/**
 * Handle voice audio chunk
 */
async function handleVoiceAudioChunk(
  client: ConnectedClient,
  payload: { data: string }
): Promise<void> {
  if (!client.authenticated) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  const voiceService = getVoiceService();
  voiceService.sendAudioToSTT(client.id, payload.data);
}

/**
 * Handle voice end (push-to-talk ends)
 * Processes the transcribed text as a user message
 */
async function handleVoiceEnd(client: ConnectedClient): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  const voiceService = getVoiceService();

  // Signal end of audio
  voiceService.endSTTAudio(client.id);

  // Wait a moment for final transcription
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Stop STT session
  await voiceService.stopSTTSession(client.id);

  const transcription = client.voiceTranscription.trim();

  if (!transcription) {
    logger.debug({ clientId: client.id }, 'Voice ended with no transcription');
    return;
  }

  logger.info(
    { clientId: client.id, transcription: transcription.substring(0, 50) },
    'Voice transcription complete'
  );

  // Process transcription as a user message (this will also trigger TTS if voice is enabled)
  await handleUserMessage(client, { content: transcription });
}

/**
 * Send TTS audio for agent response
 */
async function sendTTSForResponse(
  client: ConnectedClient,
  text: string,
  voiceId: string,
  voiceTuning: { stability?: number; similarityBoost?: number; style?: number; useSpeakerBoost?: boolean }
): Promise<void> {
  const voiceService = getVoiceService();

  await voiceService.synthesizeTTSStream(
    text,
    {
      voiceId,
      tuning: voiceTuning,
    },
    (chunk: Buffer, format: string) => {
      send(client, {
        type: 'tts_audio_chunk',
        payload: {
          data: chunk.toString('base64'),
          format,
        },
      });
    },
    () => {
      send(client, {
        type: 'tts_audio_end',
        payload: {},
      });
    },
    (error: string) => {
      logger.error({ clientId: client.id, error }, 'TTS error');
      sendError(client, `TTS error: ${error}`);
    }
  );
}

/**
 * Send a message to a client
 */
function send(client: ConnectedClient, message: Omit<WSMessage, 'id' | 'timestamp'>): void {
  const fullMessage: WSMessage = {
    ...message,
    id: nanoid(),
    timestamp: new Date().toISOString(),
  };

  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(fullMessage));
  }
}

/**
 * Send an error message to a client
 */
function sendError(client: ConnectedClient, message: string): void {
  send(client, {
    type: 'error',
    payload: { message },
  });
}

/**
 * Check heartbeats and disconnect stale clients
 */
function checkHeartbeats(): void {
  const now = Date.now();

  for (const [clientId, client] of clients) {
    const timeSinceLastPing = now - client.lastPing.getTime();

    if (timeSinceLastPing > CLIENT_TIMEOUT) {
      logger.info({ clientId, timeSinceLastPing }, 'Disconnecting stale client');
      client.ws.close(1000, 'Connection timeout');
      clients.delete(clientId);
    } else if (timeSinceLastPing > HEARTBEAT_INTERVAL) {
      // Send ping
      send(client, { type: 'ping', payload: {} });
    }
  }
}

/**
 * Broadcast a message to all authenticated clients
 */
export function broadcast(message: Omit<WSMessage, 'id' | 'timestamp'>): void {
  for (const client of clients.values()) {
    if (client.authenticated) {
      send(client, message);
    }
  }
}

/**
 * Send a message to a specific user
 */
export function sendToUser(userId: string, message: Omit<WSMessage, 'id' | 'timestamp'>): void {
  for (const client of clients.values()) {
    if (client.user?.userId === userId) {
      send(client, message);
    }
  }
}

/**
 * Send a message to a specific session
 */
export function sendToSession(sessionId: string, message: Omit<WSMessage, 'id' | 'timestamp'>): void {
  for (const client of clients.values()) {
    if (client.sessionId === sessionId) {
      send(client, message);
    }
  }
}

/**
 * Get count of connected clients
 */
export function getConnectedClientCount(): number {
  return clients.size;
}

/**
 * Get count of authenticated clients
 */
export function getAuthenticatedClientCount(): number {
  let count = 0;
  for (const client of clients.values()) {
    if (client.authenticated) count++;
  }
  return count;
}
