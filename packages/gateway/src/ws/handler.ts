/**
 * WebSocket Handler
 * Real-time bidirectional communication for voice and chat.
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { logger } from '../observability/logger.js';
import { verifyToken, type AuthenticatedUser } from '../middleware/auth.js';
import {
  getCompanionsService,
  getSessionsService,
  getEventsService,
  getVoiceService,
  getTenetsService,
  getLLMUsageService,
  type EventContext,
} from '../services/index.js';
import { getKnowledgeGraphRepository, getSessionsRepository, getGiftsRepository } from '../repositories/index.js';
import { getAnonymousUsageRepository } from '../repositories/anonymous-usage.js';
import { getUsersRepository } from '../repositories/users.js';
import { getAdminSettingsRepository } from '../repositories/admin-settings.js';
import { getEngagementRepository } from '../repositories/engagement.js';
import { getEngagementService } from '../services/engagement.js';
import type { EngagementLevel, UUID } from '../db/types.js';
import { renderPromptFromDb } from '../services/prompt-runtime.js';
import { getCreatorEarningsService } from '../services/creator-earnings.js';
import { env } from '../env.js';

import { enqueueSummaryJob } from '../utils/queue.js';

import { uploadWebcamFrame } from '../utils/webcam-storage.js';

// Anonymous user ID prefix - actual ID is generated per-session for tracking
const ANONYMOUS_USER_ID_PREFIX = 'anon-';

// System anonymous user ID - must match the ID used in demo routes
const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

// Orchestrator base URL
const ORCHESTRATOR_URL = env.ORCHESTRATOR_URL;

// ============================================================================
// WebSocket Payload Validation Schemas
// ============================================================================

const AuthPayloadSchema = z.object({
  token: z.string().min(1).max(4096),
});

const AuthAnonymousPayloadSchema = z.object({
  fingerprint: z.string().min(1).max(64),
});

const SessionStartPayloadSchema = z.object({
  companionId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
}).refine(data => data.companionId || data.sessionId, {
  message: 'Either companionId or sessionId is required',
});

const UserMessagePayloadSchema = z.object({
  content: z.string().min(1).max(32000), // Max 32KB message
});

const AudioChunkPayloadSchema = z.object({
  data: z.string().min(1).max(1048576), // Max 1MB base64 chunk
  sequence: z.number().int().min(0),
});

const VoiceEnabledPayloadSchema = z.object({
  enabled: z.boolean(),
});

const VoiceAudioChunkPayloadSchema = z.object({
  data: z.string().min(1).max(1048576), // Max 1MB base64 chunk
});

const WebcamEnabledPayloadSchema = z.object({
  enabled: z.boolean(),
});

const WebcamFramePayloadSchema = z.object({
  data: z.string().min(1).max(5242880), // Max 5MB base64 frame
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  timestamp: z.number().int().min(0),
});

const StartGamePayloadSchema = z.object({
  gameType: z.string().min(1).max(50),
});

const UserGameMovePayloadSchema = z.object({
  move: z.string().min(1).max(100),
});

const LikeMessagePayloadSchema = z.object({
  turnId: z.string().uuid(),
});

const InviteCompanionPayloadSchema = z.object({
  friendCompanionId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

const DismissCompanionPayloadSchema = z.object({
  companionId: z.string().uuid(),
});

/**
 * Validate a WebSocket message payload against its schema
 * Returns the validated data or null if invalid
 */
function validatePayload<T>(
  schema: z.ZodSchema<T>,
  payload: unknown,
  messageType: string,
  client: ConnectedClient
): T | null {
  const result = schema.safeParse(payload);
  if (!result.success) {
    logger.warn(
      { clientId: client.id, messageType, errors: result.error.flatten() },
      'Invalid WebSocket payload'
    );
    sendError(client, `Invalid payload for ${messageType}: ${result.error.issues[0]?.message || 'validation failed'}`);
    return null;
  }
  return result.data;
}

/**
 * Sleep utility for typing delays between messages
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ImageIntentDecision {
  shouldGenerateImage: boolean;
  confidence: number;
}

const EXPLICIT_IMAGE_INTENT_PATTERNS: RegExp[] = [
  /\bshow\s+me\b/i,
  /\blet\s+me\s+see\b/i,
  /\bsend\s+me\s+(a|an)?\s*(pic|picture|photo|image|selfie)\b/i,
  /\bcan\s+i\s+see\b/i,
  /\bwhat\s+do\s+you\s+look\s+like\b/i,
  /\bwhat\s+are\s+you\s+wearing\b/i,
  /\bpicture\s+of\s+you\b/i,
  /\bphoto\s+of\s+you\b/i,
  /\bselfie\b/i,
];

const WEAK_IMAGE_INTENT_PATTERNS: RegExp[] = [
  /\bpose\b/i,
  /\boutfit\b/i,
  /\blook\b.*\blike\b/i,
];

function detectImageIntent(message: string): ImageIntentDecision {
  const content = message.trim();
  if (!content) {
    return { shouldGenerateImage: false, confidence: 0 };
  }

  if (EXPLICIT_IMAGE_INTENT_PATTERNS.some(pattern => pattern.test(content))) {
    return { shouldGenerateImage: true, confidence: 0.95 };
  }

  if (WEAK_IMAGE_INTENT_PATTERNS.some(pattern => pattern.test(content))) {
    return { shouldGenerateImage: true, confidence: 0.65 };
  }

  return { shouldGenerateImage: false, confidence: 0.05 };
}

function extractConfiguredAllowedTools(spec: Record<string, unknown> | null | undefined): string[] {
  if (!spec || typeof spec !== 'object') {
    return [];
  }

  const normalized = new Set<string>();
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        normalized.add(item.trim());
      }
    }
  };

  collect(spec['allowed_tools']);
  collect(spec['allowedTools']);
  collect(spec['tools']);

  const toolsConfig = spec['tooling'];
  if (toolsConfig && typeof toolsConfig === 'object') {
    collect((toolsConfig as Record<string, unknown>)['allowed_tools']);
    collect((toolsConfig as Record<string, unknown>)['allowedTools']);
    collect((toolsConfig as Record<string, unknown>)['tools']);
  }

  return Array.from(normalized);
}

/**
 * WebSocket message types
 */
export type WSMessageType =
  | 'ping'
  | 'pong'
  | 'auth'
  | 'auth_anonymous'
  | 'auth_success'
  | 'auth_error'
  | 'limit_reached'
  | 'usage_update'
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
  | 'webcam_enabled'
  | 'webcam_frame'
  | 'game_update'
  | 'user_game_move'
  | 'start_game'
  | 'resign_game'
  | 'like_message'
  | 'like_acknowledged'
  // Group chat message types
  | 'companion_invited'
  | 'companion_joined'
  | 'companion_left'
  | 'companion_message_start'
  | 'companion_message_chunk'
  | 'companion_message_end'
  | 'group_chat_state'
  | 'invite_companion'
  | 'dismiss_companion'
  // Voice call message types
  | 'voice_call_start'
  | 'voice_call_end'
  | 'voice_call_started'
  | 'voice_call_ended'
  | 'voice_call_interrupt'
  | 'voice_call_insufficient_tokens'
  | 'voice_call_balance_update'
  | 'engagement_update'
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
 * Group chat participant info
 */
interface GroupParticipantInfo {
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  role: 'primary' | 'invited';
  themeColor: string;
  joinedAt: Date;
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
  companionOwnerUserId?: string;
  authenticated: boolean;
  connectedAt: Date;
  lastPing: Date;
  voiceEnabled: boolean;
  voiceTranscription: string;
  webcamEnabled: boolean;
  lastWebcamFrame?: {
    s3Url: string;
    capturedAt: Date;
    width: number;
    height: number;
  };
  // Group chat state
  isGroupChat: boolean;
  groupParticipants: Map<string, GroupParticipantInfo>;
  // Anonymous user state
  isAnonymous: boolean;
  fingerprint: string | null;
  // Voice call state
  voiceCallActive: boolean;
  voiceCallStartedAt?: Date;
  // Voice call billing state
  voiceCallBillingInterval?: ReturnType<typeof setInterval>;
  voiceCallTokensDeducted: number;
  // Engagement tracking state (for anonymous users)
  lastMessageTimestamp?: Date;
  previousMessages: string[];
  // Rate limiting state
  rateLimitMessages: number;
  rateLimitWindowStart: number;
}

// Active connections
const clients = new Map<string, ConnectedClient>();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 60000;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const RATE_LIMIT_MAX_MESSAGES = 20; // max 20 messages per second
const RATE_LIMIT_MAX_BURST = 50; // allow burst up to 50 messages

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
      webcamEnabled: false,
      isGroupChat: false,
      groupParticipants: new Map(),
      isAnonymous: false,
      fingerprint: null,
      voiceCallActive: false,
      voiceCallTokensDeducted: 0,
      previousMessages: [],
      rateLimitMessages: 0,
      rateLimitWindowStart: Date.now(),
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
 * Check rate limit for a client
 * Returns true if request is allowed, false if rate limited
 */
function checkRateLimit(client: ConnectedClient): boolean {
  const now = Date.now();

  // Reset window if expired
  if (now - client.rateLimitWindowStart >= RATE_LIMIT_WINDOW_MS) {
    client.rateLimitWindowStart = now;
    client.rateLimitMessages = 0;
  }

  client.rateLimitMessages++;

  // Allow burst but enforce hard limit
  if (client.rateLimitMessages > RATE_LIMIT_MAX_BURST) {
    return false;
  }

  // Soft limit: warn but allow
  if (client.rateLimitMessages > RATE_LIMIT_MAX_MESSAGES) {
    logger.warn(
      { clientId: client.id, messages: client.rateLimitMessages },
      'Client exceeding rate limit'
    );
  }

  return true;
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(client: ConnectedClient, message: WSMessage): Promise<void> {
  client.lastPing = new Date();

  // Rate limit check (except for ping/pong which are lightweight)
  if (message.type !== 'ping' && message.type !== 'pong') {
    if (!checkRateLimit(client)) {
      sendError(client, 'Rate limit exceeded. Please slow down.');
      logger.warn({ clientId: client.id, messageType: message.type }, 'Rate limit exceeded');
      return;
    }
  }

  switch (message.type) {
    case 'ping':
      send(client, { type: 'pong', payload: {} });
      break;

    case 'pong':
      // Just update lastPing (already done above)
      break;

    case 'auth': {
      const payload = validatePayload(AuthPayloadSchema, message.payload, 'auth', client);
      if (payload) await handleAuth(client, payload);
      break;
    }

    case 'auth_anonymous': {
      const payload = validatePayload(AuthAnonymousPayloadSchema, message.payload, 'auth_anonymous', client);
      if (payload) await handleAuthAnonymous(client, payload);
      break;
    }

    case 'session_start': {
      const payload = validatePayload(SessionStartPayloadSchema, message.payload, 'session_start', client);
      if (payload) await handleSessionStart(client, payload);
      break;
    }

    case 'session_end':
      await handleSessionEnd(client);
      break;

    case 'user_message': {
      const payload = validatePayload(UserMessagePayloadSchema, message.payload, 'user_message', client);
      if (payload) await handleUserMessage(client, payload);
      break;
    }

    case 'audio_chunk': {
      const payload = validatePayload(AudioChunkPayloadSchema, message.payload, 'audio_chunk', client);
      if (payload) await handleAudioChunk(client, payload);
      break;
    }

    case 'audio_end':
      await handleAudioEnd(client);
      break;

    case 'voice_enabled': {
      const payload = validatePayload(VoiceEnabledPayloadSchema, message.payload, 'voice_enabled', client);
      if (payload) await handleVoiceEnabled(client, payload);
      break;
    }

    case 'voice_start':
      await handleVoiceStart(client);
      break;

    case 'voice_audio_chunk': {
      const payload = validatePayload(VoiceAudioChunkPayloadSchema, message.payload, 'voice_audio_chunk', client);
      if (payload) await handleVoiceAudioChunk(client, payload);
      break;
    }

    case 'voice_end':
      await handleVoiceEnd(client);
      break;

    case 'webcam_enabled': {
      const payload = validatePayload(WebcamEnabledPayloadSchema, message.payload, 'webcam_enabled', client);
      if (payload) await handleWebcamEnabled(client, payload);
      break;
    }

    case 'webcam_frame': {
      const payload = validatePayload(WebcamFramePayloadSchema, message.payload, 'webcam_frame', client);
      if (payload) await handleWebcamFrame(client, payload);
      break;
    }

    case 'start_game': {
      const payload = validatePayload(StartGamePayloadSchema, message.payload, 'start_game', client);
      if (payload) await handleStartGame(client, payload);
      break;
    }

    case 'user_game_move': {
      const payload = validatePayload(UserGameMovePayloadSchema, message.payload, 'user_game_move', client);
      if (payload) await handleUserGameMove(client, payload);
      break;
    }

    case 'resign_game':
      await handleResignGame(client);
      break;

    case 'like_message': {
      const payload = validatePayload(LikeMessagePayloadSchema, message.payload, 'like_message', client);
      if (payload) await handleLikeMessage(client, payload);
      break;
    }

    case 'invite_companion': {
      const payload = validatePayload(InviteCompanionPayloadSchema, message.payload, 'invite_companion', client);
      if (payload) await handleInviteCompanion(client, payload);
      break;
    }

    case 'dismiss_companion': {
      const payload = validatePayload(DismissCompanionPayloadSchema, message.payload, 'dismiss_companion', client);
      if (payload) await handleDismissCompanion(client, payload);
      break;
    }

    case 'voice_call_start':
      await handleVoiceCallStart(client);
      break;

    case 'voice_call_end':
      await handleVoiceCallEnd(client);
      break;

    case 'voice_call_interrupt':
      await handleVoiceCallInterrupt(client);
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
 * Handle anonymous authentication message
 */
async function handleAuthAnonymous(client: ConnectedClient, payload: { fingerprint: string }): Promise<void> {
  if (!payload.fingerprint || payload.fingerprint.length === 0 || payload.fingerprint.length > 64) {
    send(client, {
      type: 'auth_error',
      payload: { message: 'Invalid fingerprint' },
    });
    return;
  }

  const anonymousUsageRepo = getAnonymousUsageRepository();
  const adminSettingsRepo = getAdminSettingsRepository();

  // Get or create usage record
  const usage = await anonymousUsageRepo.getOrCreate(payload.fingerprint);

  // Get the message limit from admin settings
  const limitSetting = await adminSettingsRepo.getValue<{ value: number }>('free_trial_message_limit');
  const limit = limitSetting?.value ?? 10;

  // Use the system anonymous user ID to match sessions created via demo routes
  // The fingerprint stored on the client is used for tracking/analytics
  client.user = {
    userId: ANONYMOUS_USER_ID,
    email: 'anonymous@campfire.local',
    role: 'user',
  };
  client.authenticated = true;
  client.isAnonymous = true;
  client.fingerprint = payload.fingerprint;

  logger.info(
    { clientId: client.id, fingerprint: payload.fingerprint.substring(0, 8) + '...', messagesUsed: usage.messages_used },
    'WebSocket client authenticated as anonymous'
  );

  send(client, {
    type: 'auth_success',
    payload: {
      userId: ANONYMOUS_USER_ID,
      isAnonymous: true,
      usage: {
        messagesUsed: usage.messages_used,
        messageLimit: limit,
        remaining: Math.max(0, limit - usage.messages_used),
      },
    },
  });
}

/**
 * Check engagement-based conversion for anonymous users
 * Returns { proceed: true, engagementLevel } if user can continue,
 * Returns { proceed: false } if conversion triggered
 */
async function checkEngagementConversion(
  client: ConnectedClient,
  messageContent: string
): Promise<{ proceed: boolean; engagementLevel?: EngagementLevel }> {
  if (!client.isAnonymous || !client.fingerprint) {
    return { proceed: true, engagementLevel: 'high' };
  }

  const anonymousUsageRepo = getAnonymousUsageRepository();
  const engagementRepo = getEngagementRepository();
  const engagementService = getEngagementService();

  // Get or create usage record
  const usage = await engagementRepo.getUsageWithEngagement(client.fingerprint);
  if (!usage) {
    // First message - create usage record and allow
    await anonymousUsageRepo.getOrCreate(client.fingerprint);
    return { proceed: true, engagementLevel: 'low' };
  }

  // Check if conversion was already triggered
  if (usage.conversion_triggered_at) {
    send(client, {
      type: 'limit_reached',
      payload: {
        messagesUsed: usage.messages_used,
        engagementScore: usage.engagement_score,
        reason: 'already_triggered',
      },
    });
    return { proceed: false };
  }

  const messageNumber = usage.messages_used + 1;

  // Calculate response time from last message
  const responseTimeMs = client.lastMessageTimestamp
    ? Date.now() - client.lastMessageTimestamp.getTime()
    : null;

  // Analyze the message for engagement signals
  const analysis = engagementService.analyzeMessage(
    messageContent,
    client.previousMessages,
    responseTimeMs
  );

  // Record the engagement signal
  await engagementRepo.recordSignal({
    anonymous_usage_id: usage.id,
    session_id: client.sessionId ?? null,
    message_number: messageNumber,
    sentiment_score: analysis.sentimentScore,
    personal_pronoun_density: analysis.personalPronounDensity,
    vulnerability_score: analysis.vulnerabilityScore,
    emotional_language_score: analysis.emotionalLanguageScore,
    message_length_score: analysis.messageLengthScore,
    question_engagement_score: analysis.questionEngagementScore,
    topic_depth_score: analysis.topicDepthScore,
    response_time_score: analysis.responseTimeScore,
    emotional_depth_score: analysis.emotionalDepthScore,
    investment_score: analysis.investmentScore,
    combined_score: analysis.combinedScore,
    message_length: analysis.messageLength,
    word_count: analysis.wordCount,
    question_count: analysis.questionCount,
    response_time_ms: analysis.responseTimeMs,
  });

  // Get all signals and compute cumulative score
  const allSignals = await engagementRepo.getSignalsByUsage(usage.id);
  const cumulativeScore = engagementService.computeCumulativeScore(allSignals);

  // Update cumulative score on usage record
  await engagementRepo.updateCumulativeScore(usage.id, cumulativeScore);

  // Get conversion config
  const config = await engagementRepo.getConfig();

  // Check if we should trigger conversion
  const decision = engagementService.shouldTriggerConversion(
    messageNumber,
    cumulativeScore,
    config
  );

  // Update tracking state on client
  await anonymousUsageRepo.incrementMessages(client.fingerprint);
  client.lastMessageTimestamp = new Date();
  client.previousMessages = [...client.previousMessages, messageContent].slice(-10);

  const engagementLevel = engagementService.getEngagementLevel(cumulativeScore);

  if (decision.shouldTrigger) {
    // Mark conversion as triggered
    await engagementRepo.markConversionTriggered(usage.id, messageNumber);

    send(client, {
      type: 'limit_reached',
      payload: {
        messagesUsed: messageNumber,
        engagementScore: cumulativeScore,
        reason: decision.reason,
      },
    });

    logger.info(
      {
        fingerprint: client.fingerprint,
        messageNumber,
        engagementScore: cumulativeScore,
        reason: decision.reason,
      },
      'Engagement-based conversion triggered'
    );

    return { proceed: false };
  }

  // Send engagement update to client
  send(client, {
    type: 'engagement_update',
    payload: {
      messagesUsed: messageNumber,
      engagementScore: cumulativeScore,
      maxMessages: config.maxMessages,
      engagementLevel,
      analysis: {
        emotionalDepth: analysis.emotionalDepthScore,
        investment: analysis.investmentScore,
        combined: analysis.combinedScore,
      },
    },
  });

  return { proceed: true, engagementLevel };
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
      // Resume existing session (admins can access any session)
      // First check if session exists at all
      const sessionsRepo = getSessionsRepository();
      const sessionExists = await sessionsRepo.findById(payload.sessionId);

      if (!sessionExists) {
        sendError(client, 'Session not found', 'SESSION_NOT_FOUND');
        return;
      }

      // Then check if user has access
      const session = await sessionsService.getById(
        client.user.userId,
        payload.sessionId,
        { isAdmin: client.user.role === 'admin' }
      );
      if (!session) {
        // Session exists but user doesn't have access
        sendError(client, 'You do not have access to this conversation', 'SESSION_ACCESS_DENIED');
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
    client.companionOwnerUserId = undefined;

    try {
      const companion = await companionsService.getById(client.user.userId, companionId);
      if (companion) {
        client.companionOwnerUserId = companion.user_id;
      }
    } catch {
      // Best-effort only (used for creator earnings attribution)
    }

    // Load session participants for group chat support
    const participants = await sessionsService.getActiveParticipants(client.user.userId, sessionId);
    client.groupParticipants.clear();

    for (const p of participants) {
      client.groupParticipants.set(p.companion_id, {
        companionId: p.companion_id,
        companionName: p.companion_name,
        avatarUrl: p.companion_avatar_url,
        role: p.role,
        themeColor: getThemeColorForIndex(client.groupParticipants.size),
        joinedAt: new Date(p.joined_at),
      });
    }

    // Session becomes a group chat when there are multiple participants
    client.isGroupChat = client.groupParticipants.size > 1;

    logger.debug(
      { sessionId, participantCount: client.groupParticipants.size, isGroupChat: client.isGroupChat },
      'Session participants loaded'
    );

    send(client, {
      type: 'session_started',
      payload: {
        sessionId,
        companionId,
        isGroupChat: client.isGroupChat,
        participants: Array.from(client.groupParticipants.values()).map(p => ({
          companionId: p.companionId,
          companionName: p.companionName,
          avatarUrl: p.avatarUrl,
          role: p.role,
          themeColor: p.themeColor,
          joinedAt: p.joinedAt.toISOString(),
        })),
      },
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
    client.isGroupChat = false;
    client.groupParticipants.clear();

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

  // Check engagement-based conversion for anonymous users
  let engagementLevel: EngagementLevel | undefined;
  if (client.isAnonymous) {
    const result = await checkEngagementConversion(client, payload.content);
    if (!result.proceed) {
      return; // Conversion triggered, message already sent to client
    }
    engagementLevel = result.engagementLevel;
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

    // 5. Fetch core tenets for the companion
    const tenetsService = getTenetsService();
    const coreTenets = await tenetsService.getCoreTenets(companionId);

    // Map core tenets to orchestrator's BehavioralTenet format
    const mappedTenets = coreTenets.map(tenet => ({
      id: tenet.id,
      category: tenet.category,
      priority: 'core' as const,
      rule: tenet.rule,
      description: null,
      is_negation: tenet.isNegation,
      trigger_contexts: [],
    }));

    // 6. Fetch user safety preference and compute effective safety level
    const spec = companion.spec;
    const usersRepo = getUsersRepository();
    const userProfile = await usersRepo.findProfileByUserId(userId);
    const userSafetyLevel = (userProfile?.preferences as Record<string, unknown> | undefined)?.safetyLevel as string | undefined;
    const companionSafetyLevel = mapContentRatingToSafetyLevel(spec?.boundaries?.content_rating);
    const effectiveSafetyLevel = getEffectiveSafetyLevel(userSafetyLevel, companionSafetyLevel);
    const visualIntent = detectImageIntent(payload.content);
    const configuredAllowedTools = extractConfiguredAllowedTools(
      spec as unknown as Record<string, unknown> | null | undefined
    );
    const allowedTools = new Set(configuredAllowedTools);

    if (visualIntent.shouldGenerateImage) {
      allowedTools.add('image_generation');
    }

    const allowedToolsList = Array.from(allowedTools);
    const allowImagePromptFallback = !allowedToolsList.includes('image_generation');

    logger.debug(
      {
        userId,
        companionId,
        userSafetyLevel,
        companionSafetyLevel,
        effectiveSafetyLevel,
        visualIntent,
        allowedTools: allowedToolsList,
      },
      'Computed effective safety level'
    );

    // 7. Build CompanionSpec for orchestrator
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
      system_prompt: await buildSystemPrompt(
        companionId,
        companion as unknown as { name: string; spec: Record<string, unknown> | null }
      ),
      safety_level: effectiveSafetyLevel,
      allowed_tools: allowedToolsList,
      can_generate_image_prompts: allowImagePromptFallback,
      max_context_turns: 20,
      temperature: 0.7,
      version: companion.spec_version,
      core_tenets: mappedTenets,
    };

    // 8. Fetch companion self-knowledge from KG
    const selfKnowledge = await fetchCompanionSelfKnowledge(userId, companionId, companion.name);

    // 9. Get recent turns for context (match max_context_turns in companion spec)
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

    // 8. Fetch session with metadata for game state
    const session = await sessionsService.getById(userId, sessionId);
    const activeGame = session?.metadata?.activeGame as Record<string, unknown> | undefined;

    // 8a. Fetch session summary for context retention
    const summaryText = await sessionsService.getContextSummary(userId, sessionId, companionId);
    // Format as SessionSummary object for orchestrator
    const sessionSummary = summaryText ? {
      session_id: sessionId,
      user_id: userId,
      companion_id: companionId,
      summary_text: summaryText,
      key_topics: [],
      emotional_state: null,
      last_interaction: new Date().toISOString(),
      turn_count: formattedTurns.length,
      version: 1,
    } : null;

    // 8a. Check for recent webcam frame to include in context
    let userImageUrl: string | undefined;
    if (client.webcamEnabled && client.lastWebcamFrame) {
      const frameAge = Date.now() - client.lastWebcamFrame.capturedAt.getTime();
      // Only include if frame is less than 30 seconds old
      if (frameAge < 30000) {
        userImageUrl = client.lastWebcamFrame.s3Url;
        logger.debug(
          { sessionId, frameAge, width: client.lastWebcamFrame.width, height: client.lastWebcamFrame.height },
          'Including webcam frame in orchestrator request'
        );
      }
    }

    // 8b. Fetch liked turns for companion awareness
    const likedTurns = await getSessionsRepository().getLikedTurns(sessionId, 5);
    const likedContent = likedTurns.length > 0
      ? likedTurns.map(t => ({
          content_snippet: t.contentSnippet,
          like_count: t.likeCount,
        }))
      : null;

    // 8c. Build group chat context if applicable
    let groupChatContext: {
      is_group_chat: boolean;
      host_companion_id: string;
      participants: Array<{
        companion_id: string;
        companion_name: string;
        avatar_url: string | null;
        role: 'primary' | 'invited';
        theme_color: string;
      }>;
    } | null = null;

    if (client.isGroupChat && client.groupParticipants.size > 1) {
      // Build companion specs for all participants
      const participantSpecs = await Promise.all(
        Array.from(client.groupParticipants.values()).map(async (p) => {
          const pCompanion = await companionsService.getById(userId, p.companionId);
          if (!pCompanion) return null;

          const pSpec = pCompanion.spec;
          const pTenets = await tenetsService.getCoreTenets(p.companionId);

          return {
            companion_id: p.companionId,
            companion_name: p.companionName,
            avatar_url: p.avatarUrl,
            role: p.role,
            theme_color: p.themeColor,
            spec: {
              id: pCompanion.id,
              name: pCompanion.name,
              description: (pSpec?.identity as Record<string, unknown> | undefined)?.['selfDescription'] as string | undefined
                || `An AI companion named ${pCompanion.name}`,
              personality_traits: pSpec?.personality?.traits
                ? Object.entries(pSpec.personality.traits)
                    .filter(([_, v]) => (v as number) > 0.5)
                    .map(([k]) => k)
                : ['friendly', 'helpful'],
              communication_style: pSpec?.personality?.archetype || 'friendly and supportive',
              archetype: pSpec?.personality?.archetype || null,
              temperature: 0.7,
              core_tenets: pTenets.map(tenet => ({
                id: tenet.id,
                category: tenet.category,
                priority: 'core' as const,
                rule: tenet.rule,
                description: null,
                is_negation: tenet.isNegation,
                trigger_contexts: [],
              })),
            },
          };
        })
      );

      const validParticipants = participantSpecs.filter((p): p is NonNullable<typeof p> => p !== null);

      groupChatContext = {
        is_group_chat: true,
        host_companion_id: companionId,
        participants: validParticipants.map(p => ({
          companion_id: p.companion_id,
          companion_name: p.companion_name,
          avatar_url: p.avatar_url,
          role: p.role,
          theme_color: p.theme_color,
        })),
      };

      logger.debug(
        { sessionId, participantCount: validParticipants.length },
        'Group chat context built'
      );
    }

    // 9. Call orchestrator streaming endpoint
    const isGroupChat = client.isGroupChat && client.groupParticipants.size > 1;
    const orchestratorUrl = isGroupChat ? `${ORCHESTRATOR_URL}/group/stream` : `${ORCHESTRATOR_URL}/stream`;

    const orchestratorRequest = {
      session_id: sessionId,
      user_id: userId,
      companion_spec: companionSpec,
      user_message: payload.content,
      recent_turns: formattedTurns,
      session_summary: sessionSummary,
      long_term_memories: null,
      companion_self_knowledge: selfKnowledge.length > 0 ? selfKnowledge : null,
      user_image_url: userImageUrl,
      active_game: activeGame || null,
      liked_content: likedContent,
      // Group chat fields
      group_chat: groupChatContext,
      // Engagement level for anonymous user guidance
      engagement_level: engagementLevel ?? null,
    };

    logger.debug(
      { sessionId, companionId, orchestratorUrl, isGroupChat },
      'Calling orchestrator'
    );

    const response = await fetch(orchestratorUrl, {
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
    let imagePrompt: string | undefined;
    let generatedImageUrl: string | undefined;
    let shouldGenerateImage = visualIntent.shouldGenerateImage;
    let imageIntentConfidence = visualIntent.confidence;
    let multiMessageSent = false; // Track if we sent multi-messages (skip final agent_message_end)
    let currentSpeakerId: string | undefined; // Track current speaker for group chat
    let currentSpeakerName: string | undefined;
    let currentSpeakerContent = ''; // Accumulate content per speaker
    let isGroupChatResponse = isGroupChat;
    let usageInfo: { provider?: string; model?: string } = {}; // Track actual LLM used
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      sendError(client, 'Failed to read response stream');
      return;
    }

    // Buffer for accumulating partial SSE lines across chunks
    // (iOS/mobile networks often fragment TCP packets, causing lines to be split)
    let lineBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        lineBuffer += chunk;

        // Parse SSE format: "data: {content}\n\n"
        // Split on newlines but keep the last potentially incomplete line in buffer
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep last (potentially incomplete) line

        logger.trace(
          { sessionId, chunkLen: chunk.length, lineCount: lines.length, bufferLen: lineBuffer.length },
          'SSE chunk received'
        );

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              // Stream complete
              continue;
            }

            if (data.startsWith('[ERROR]')) {
              const errorMessage = data.slice(8).trim() || 'Unknown error'; // Remove [ERROR] prefix
              logger.error({ error: errorMessage }, 'Orchestrator stream error');
              sendError(client, `AI processing error: ${errorMessage}`, 'ORCHESTRATOR_ERROR');
              return;
            }

            if (data.startsWith('[METADATA]')) {
              // Parse metadata (contains image prompt + intent signals from orchestrator)
              try {
                const metadataJson = data.slice(10); // Remove [METADATA] prefix
                const metadata = JSON.parse(metadataJson) as {
                  image_prompt?: string;
                  generated_image_url?: string;
                  should_generate_image?: boolean;
                  intent_confidence?: number;
                };
                if (metadata.image_prompt) {
                  imagePrompt = metadata.image_prompt;
                  logger.info(
                    {
                      sessionId,
                      imagePromptLength: imagePrompt?.length,
                      imagePrompt: imagePrompt?.slice(0, 200),
                    },
                    'Received image_prompt from orchestrator'
                  );
                }
                if (typeof metadata.should_generate_image === 'boolean') {
                  shouldGenerateImage = metadata.should_generate_image;
                }
                if (metadata.generated_image_url) {
                  generatedImageUrl = metadata.generated_image_url;
                }
                if (typeof metadata.intent_confidence === 'number') {
                  imageIntentConfidence = Math.max(0, Math.min(1, metadata.intent_confidence));
                }
              } catch (e) {
                logger.warn({ error: e, data }, 'Failed to parse metadata');
              }
              continue;
            }

            if (data.startsWith('[USAGE]')) {
              // Parse usage info (contains provider/model used)
              try {
                const usageJson = data.slice(7); // Remove [USAGE] prefix
                const usage = JSON.parse(usageJson);
                if (usage.provider || usage.model) {
                  usageInfo = { provider: usage.provider, model: usage.model };
                  logger.debug(
                    { sessionId, provider: usage.provider, model: usage.model },
                    'Received usage info from orchestrator'
                  );
                }
              } catch (e) {
                logger.warn({ error: e, data }, 'Failed to parse usage info');
              }
              continue;
            }

            // Group chat: Companion speaker start
            if (data.startsWith('[COMPANION_START]')) {
              try {
                const speakerJson = data.slice(17); // Remove [COMPANION_START] prefix
                const speakerData = JSON.parse(speakerJson) as {
                  companion_id: string;
                  companion_name: string;
                  theme_color: string;
                  is_reaction: boolean;
                };

                currentSpeakerId = speakerData.companion_id;
                currentSpeakerName = speakerData.companion_name;
                currentSpeakerContent = '';

                send(client, {
                  type: 'companion_message_start',
                  payload: {
                    companionId: speakerData.companion_id,
                    companionName: speakerData.companion_name,
                    themeColor: speakerData.theme_color,
                    isReaction: speakerData.is_reaction,
                    turnId: turn.id,
                  },
                });

                logger.debug(
                  { sessionId, speakerId: currentSpeakerId, speakerName: currentSpeakerName },
                  'Group chat companion started speaking'
                );
              } catch (e) {
                logger.warn({ error: e, data }, 'Failed to parse [COMPANION_START] event');
              }
              continue;
            }

            // Group chat: Companion speaker end
            if (data.startsWith('[COMPANION_END]')) {
              try {
                const endJson = data.slice(15); // Remove [COMPANION_END] prefix
                const endData = JSON.parse(endJson) as {
                  companion_id: string;
                  companion_name: string;
                  full_message: string;
                  is_reaction: boolean;
                };

                // Add to full content with speaker label
                if (endData.is_reaction) {
                  fullContent += `\n[${endData.companion_name} adds]: ${endData.full_message}`;
                } else {
                  fullContent += (fullContent ? '\n' : '') + `[${endData.companion_name}]: ${endData.full_message}`;
                }

                send(client, {
                  type: 'companion_message_end',
                  payload: {
                    companionId: endData.companion_id,
                    companionName: endData.companion_name,
                    content: endData.full_message,
                    isReaction: endData.is_reaction,
                    turnId: turn.id,
                    imagePrompt: endData.companion_id === companionId && !endData.is_reaction ? imagePrompt : undefined,
                    generatedImageUrl: endData.companion_id === companionId && !endData.is_reaction ? generatedImageUrl : undefined,
                    shouldGenerateImage: endData.companion_id === companionId && !endData.is_reaction ? shouldGenerateImage : false,
                    imageIntentConfidence: endData.companion_id === companionId && !endData.is_reaction ? imageIntentConfidence : 0,
                  },
                });

                multiMessageSent = true;
                currentSpeakerId = undefined;
                currentSpeakerName = undefined;
                currentSpeakerContent = '';

                logger.debug(
                  { sessionId, speakerId: endData.companion_id, contentLength: endData.full_message.length },
                  'Group chat companion finished speaking'
                );
              } catch (e) {
                logger.warn({ error: e, data }, 'Failed to parse [COMPANION_END] event');
              }
              continue;
            }

            if (data.startsWith('[MESSAGE]')) {
              // Multi-message response: parse and send each message with sequence info
              try {
                const messageJson = data.slice(9); // Remove [MESSAGE] prefix
                const messageData = JSON.parse(messageJson) as {
                  content: string;
                  index: number;
                  total: number;
                  suggested_delay_ms: number;
                  is_last: boolean;
                };

                // Accumulate content for database storage
                fullContent += (fullContent ? '\n' : '') + messageData.content;

                // Send message with sequence info
                send(client, {
                  type: 'agent_message_end',
                  payload: {
                    content: messageData.content,
                    sessionId,
                    turnId: turn.id,
                    imagePrompt: messageData.is_last ? imagePrompt : undefined,
                    generatedImageUrl: messageData.is_last ? generatedImageUrl : undefined,
                    shouldGenerateImage: messageData.is_last ? shouldGenerateImage : false,
                    imageIntentConfidence: messageData.is_last ? imageIntentConfidence : 0,
                    sequence: {
                      index: messageData.index,
                      total: messageData.total,
                      isLast: messageData.is_last,
                      typingDelayMs: messageData.suggested_delay_ms,
                    },
                  },
                });

                multiMessageSent = true;

                logger.debug(
                  { sessionId, messageIndex: messageData.index, total: messageData.total, delayMs: messageData.suggested_delay_ms },
                  'Sent multi-message part'
                );

                // Wait for typing delay before next message (simulates natural typing)
                if (!messageData.is_last && messageData.suggested_delay_ms > 0) {
                  await sleep(messageData.suggested_delay_ms);
                }
              } catch (e) {
                logger.warn({ error: e, data }, 'Failed to parse [MESSAGE] event');
              }
              continue;
            }

            // Send chunk to client
            // Unescape newlines that were escaped for SSE transport
            const unescapedData = data.replace(/\\n/g, '\n');
            if (isGroupChatResponse && currentSpeakerId) {
              // Group chat: send chunk with companion attribution
              currentSpeakerContent += unescapedData;
              send(client, {
                type: 'companion_message_chunk',
                payload: {
                  companionId: currentSpeakerId,
                  content: unescapedData,
                },
              });
            } else {
              // Regular streaming
              fullContent += unescapedData;
              send(client, {
                type: 'agent_message_chunk',
                payload: { content: unescapedData },
              });
            }
          }
        }
      }

      // Process any remaining content in the buffer after stream ends
      if (lineBuffer.trim() && lineBuffer.startsWith('data: ')) {
        const data = lineBuffer.slice(6).trim();
        if (data && data !== '[DONE]' && !data.startsWith('[')) {
          // Unescape newlines that were escaped for SSE transport
          const unescapedData = data.replace(/\\n/g, '\n');
          fullContent += unescapedData;
          send(client, {
            type: 'agent_message_chunk',
            payload: { content: unescapedData },
          });
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

    // 10b. Record LLM usage for cost tracking
    // Uses actual provider/model from orchestrator if available, falls back to defaults
    // Skip recording for anonymous users to avoid foreign key issues
    if (!client.isAnonymous && !userId.startsWith(ANONYMOUS_USER_ID_PREFIX)) {
      try {
        const llmUsageService = getLLMUsageService();
        const provider = usageInfo.provider || 'anthropic';
        const model = usageInfo.model || 'claude-3-5-sonnet-20241022';

        // Recalculate cost based on actual model used
        const actualCostUsd = llmUsageService.calculateCost(model, estimatedInputTokens, estimatedOutputTokens);

        await llmUsageService.recordUsage({
          user_id: userId,
          session_id: sessionId,
          companion_id: companionId,
          turn_id: turn.id,
          provider,
          model,
          input_tokens: estimatedInputTokens,
          output_tokens: estimatedOutputTokens,
          cost_usd: actualCostUsd,
          latency_ms: latencyMs,
          request_type: 'chat',
          stream_mode: true,
          request_started_at: new Date(startTime),
          request_completed_at: new Date(),
        });

        logger.debug(
          { sessionId, provider, model, costUsd: actualCostUsd },
          'LLM usage recorded'
        );
      } catch (err) {
        // Don't fail the request if usage recording fails
        logger.warn({ err, sessionId, turnId: turn.id }, 'Failed to record LLM usage');
      }
    }

    // 10a. Trigger summary generation every 10 turns for context retention
    if (completedTurn.turn_number % 10 === 0) {
      enqueueSummaryJob(userId, companionId, sessionId).catch(err => {
        logger.warn({ err, sessionId }, 'Failed to enqueue summary job');
      });
    }

    // 11. Send completion message (skip if we already sent multi-messages with sequence info)
    if (!multiMessageSent) {
      send(client, {
        type: 'agent_message_end',
        payload: {
          content: fullContent,
          sessionId,
          turnId: turn.id,
          imagePrompt: imagePrompt,
          generatedImageUrl,
          shouldGenerateImage,
          imageIntentConfidence,
        },
      });
    }

    // 11a. Check for game state updates and emit game_update
    const updatedSession = await sessionsService.getById(userId, sessionId);
    const updatedActiveGame = updatedSession?.metadata?.activeGame as Record<string, unknown> | undefined;
    if (updatedActiveGame) {
      send(client, {
        type: 'game_update',
        payload: { activeGame: updatedActiveGame },
      });
      logger.debug(
        { sessionId, gameType: updatedActiveGame['gameType'], status: updatedActiveGame['status'] },
        'Game state updated'
      );
    } else if (activeGame && !updatedActiveGame) {
      // Game was ended/cleared
      send(client, {
        type: 'game_update',
        payload: { activeGame: null },
      });
      logger.debug({ sessionId }, 'Game ended');
    }

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
async function buildSystemPrompt(
  companionId: string,
  companion: { name: string; spec: Record<string, unknown> | null }
): Promise<string> {
  const spec = companion.spec || {};
  const identity = spec.identity as Record<string, string> | undefined;
  const personality = spec.personality as Record<string, unknown> | undefined;
  const boundaries = spec.boundaries as Record<string, unknown> | undefined;

  const backstoryLine = identity?.backstory ? `Background: ${identity.backstory}` : '';
  const pronounsLine = identity?.pronouns ? `Use ${identity.pronouns} pronouns when referring to yourself.` : '';
  const archetypeLine = personality?.archetype ? `Personality archetype: ${String(personality.archetype)}` : '';

  let traitsLine = '';
  if (personality?.traits && typeof personality.traits === 'object') {
    const traitDescriptions = Object.entries(personality.traits as Record<string, number>)
      .filter(([_, value]) => value > 0.5)
      .map(([trait, value]) => `${trait} (${Math.round(value * 100)}%)`)
      .join(', ');
    if (traitDescriptions) {
      traitsLine = `Key traits: ${traitDescriptions}`;
    }
  }

  const contentRatingLine = boundaries?.content_rating ? `Content rating: ${boundaries.content_rating}` : '';
  const closingLine = 'Be conversational, warm, and engaging. Listen actively and respond thoughtfully.';

  const { rendered } = await renderPromptFromDb({
    key: 'gateway.chat_system_prompt',
    companionId: companionId as unknown as UUID,
    variables: {
      companion_name: companion.name,
      backstory_line: backstoryLine,
      pronouns_line: pronounsLine,
      archetype_line: archetypeLine,
      traits_line: traitsLine,
      content_rating_line: contentRatingLine,
      closing_line: closingLine,
    },
  });
  return rendered;
}

/**
 * Map content rating (G, PG, PG-13, R) to orchestrator safety level
 */
function mapContentRatingToSafetyLevel(contentRating: string | undefined): string {
  switch (contentRating) {
    case 'R':
      return 'adult';
    case 'PG-13':
      return 'permissive';
    case 'PG':
      return 'standard';
    case 'G':
      return 'strict';
    default:
      return 'standard';
  }
}

/**
 * Safety level order (most restrictive to least restrictive)
 */
const SAFETY_LEVEL_ORDER = ['strict', 'standard', 'permissive', 'adult'];

/**
 * Get the more restrictive of two safety levels.
 * Returns the level that appears earlier in the SAFETY_LEVEL_ORDER array.
 */
function getEffectiveSafetyLevel(userSafetyLevel: string | undefined, companionSafetyLevel: string): string {
  const userLevel = userSafetyLevel || 'standard';

  const userIndex = SAFETY_LEVEL_ORDER.indexOf(userLevel);
  const companionIndex = SAFETY_LEVEL_ORDER.indexOf(companionSafetyLevel);

  // If either level is invalid, default to the other
  if (userIndex === -1) return companionSafetyLevel;
  if (companionIndex === -1) return userLevel;

  // Return the more restrictive (lower index = more restrictive)
  return userIndex <= companionIndex ? userLevel : companionSafetyLevel;
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
 * Handle webcam enabled/disabled
 */
async function handleWebcamEnabled(
  client: ConnectedClient,
  payload: { enabled: boolean }
): Promise<void> {
  if (!client.authenticated) {
    sendError(client, 'Authentication required');
    return;
  }

  client.webcamEnabled = payload.enabled;
  if (!payload.enabled) {
    // Clear last frame when webcam is disabled
    client.lastWebcamFrame = undefined;
  }
  logger.info({ clientId: client.id, webcamEnabled: payload.enabled }, 'Webcam mode updated');
}

/**
 * Handle webcam frame upload
 */
async function handleWebcamFrame(
  client: ConnectedClient,
  payload: { data: string; width: number; height: number; timestamp: number }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  if (!client.webcamEnabled) {
    // Ignore frames if webcam not enabled
    return;
  }

  try {
    // Upload to S3
    const s3Result = await uploadWebcamFrame(
      client.user.userId,
      client.sessionId,
      payload.data,
      payload.width,
      payload.height
    );

    // Store for context in next LLM call
    client.lastWebcamFrame = {
      s3Url: s3Result.s3Url,
      capturedAt: new Date(payload.timestamp),
      width: payload.width,
      height: payload.height,
    };

    logger.debug(
      {
        clientId: client.id,
        sessionId: client.sessionId,
        s3Key: s3Result.s3Key,
        sizeBytes: s3Result.sizeBytes,
      },
      'Webcam frame stored'
    );
  } catch (error) {
    logger.error({ err: error, clientId: client.id }, 'Failed to store webcam frame');
  }
}

// ===========================================================================
// Voice Call Handlers
// ===========================================================================

/**
 * Handle voice call start
 * Enables voice mode and starts the call session
 */
async function handleVoiceCallStart(client: ConnectedClient): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  const userId = client.user.userId;
  const sessionId = client.sessionId;

  // Check token balance before starting call
  const giftsRepo = getGiftsRepository();
  const balance = await giftsRepo.getTokenBalance(userId);

  if (!balance || balance.balance < 1) {
    send(client, {
      type: 'voice_call_insufficient_tokens',
      payload: {
        balance: balance?.balance ?? 0,
        required: 1,
      },
    });
    logger.info(
      { clientId: client.id, userId, balance: balance?.balance ?? 0 },
      'Voice call rejected - insufficient tokens'
    );
    return;
  }

  // Enable voice mode and mark call as active
  client.voiceEnabled = true;
  client.voiceCallActive = true;
  client.voiceCallStartedAt = new Date();
  client.voiceCallTokensDeducted = 0;

  // Start billing interval - deduct 1 token per second
  client.voiceCallBillingInterval = setInterval(async () => {
    try {
      await deductVoiceCallToken(client);
    } catch (error) {
      logger.error(
        { clientId: client.id, sessionId, error },
        'Error deducting voice call token'
      );
      // End the call on billing error to prevent further issues
      await handleVoiceCallEnd(client).catch((endError) => {
        logger.error({ clientId: client.id, error: endError }, 'Failed to end voice call after billing error');
      });
    }
  }, 1000);

  send(client, {
    type: 'voice_call_started',
    payload: {
      startedAt: client.voiceCallStartedAt.toISOString(),
      currentBalance: balance.balance,
    },
  });

  logger.info(
    { clientId: client.id, sessionId, balance: balance.balance },
    'Voice call started with token billing'
  );
}

/**
 * Deduct a single token for voice call billing.
 * Called every second during an active voice call.
 */
async function deductVoiceCallToken(client: ConnectedClient): Promise<void> {
  if (!client.voiceCallActive || !client.user || !client.sessionId) {
    return;
  }

  const userId = client.user.userId;
  const sessionId = client.sessionId;
  const giftsRepo = getGiftsRepository();
  const creatorEarnings = getCreatorEarningsService();

  const result = await giftsRepo.deductVoiceCallToken(
    userId,
    sessionId,
    'Voice call usage - 1 second'
  );

  if (result.success) {
    client.voiceCallTokensDeducted++;

    if (result.transactionId && client.companionId && client.companionOwnerUserId) {
      await creatorEarnings.recordTokenSpend({
        tokenTransactionId: result.transactionId,
        spenderUserId: userId,
        creatorUserId: client.companionOwnerUserId,
        companionId: client.companionId,
        sessionId,
        feature: 'voice_call',
        tokensSpent: 1,
        metadata: { seconds: client.voiceCallTokensDeducted },
      });
    }

    // Send balance update to client
    send(client, {
      type: 'voice_call_balance_update',
      payload: {
        balance: result.newBalance,
        tokensUsed: client.voiceCallTokensDeducted,
      },
    });

    logger.debug(
      { clientId: client.id, newBalance: result.newBalance, tokensUsed: client.voiceCallTokensDeducted },
      'Voice call token deducted'
    );
  } else {
    // Balance depleted - end the call immediately
    logger.info(
      { clientId: client.id, sessionId, tokensUsed: client.voiceCallTokensDeducted },
      'Voice call ended - tokens depleted'
    );

    // Clear billing interval
    if (client.voiceCallBillingInterval) {
      clearInterval(client.voiceCallBillingInterval);
      client.voiceCallBillingInterval = undefined;
    }

    // Calculate duration
    const duration = client.voiceCallStartedAt
      ? Math.round((Date.now() - client.voiceCallStartedAt.getTime()) / 1000)
      : 0;

    const tokensUsed = client.voiceCallTokensDeducted;

    // Reset call state
    client.voiceCallActive = false;
    client.voiceCallStartedAt = undefined;
    client.voiceEnabled = false;
    client.voiceCallTokensDeducted = 0;

    send(client, {
      type: 'voice_call_ended',
      payload: {
        duration,
        reason: 'tokens_depleted',
        tokensUsed,
      },
    });
  }
}

/**
 * Handle voice call end
 * Cleans up voice call state
 */
async function handleVoiceCallEnd(client: ConnectedClient): Promise<void> {
  if (!client.voiceCallActive) {
    return; // Already ended
  }

  // Clear billing interval
  if (client.voiceCallBillingInterval) {
    clearInterval(client.voiceCallBillingInterval);
    client.voiceCallBillingInterval = undefined;
  }

  const duration = client.voiceCallStartedAt
    ? Math.round((Date.now() - client.voiceCallStartedAt.getTime()) / 1000)
    : 0;

  const tokensUsed = client.voiceCallTokensDeducted;

  // Reset call state
  client.voiceCallActive = false;
  client.voiceCallStartedAt = undefined;
  client.voiceEnabled = false;
  client.voiceCallTokensDeducted = 0;

  send(client, {
    type: 'voice_call_ended',
    payload: {
      duration,
      reason: 'user_ended',
      tokensUsed,
    },
  });

  logger.info(
    { clientId: client.id, sessionId: client.sessionId, duration, tokensUsed },
    'Voice call ended by user'
  );
}

/**
 * Handle voice call interrupt
 * Stops TTS playback when user starts speaking
 * Note: TTS is stopped client-side; this logs the interrupt for analytics
 */
async function handleVoiceCallInterrupt(client: ConnectedClient): Promise<void> {
  if (!client.voiceCallActive) {
    return;
  }

  logger.debug({ clientId: client.id }, 'Voice call interrupted by user');
}

/**
 * Handle start game request
 * Creates a game by sending a message to the companion
 */
async function handleStartGame(
  client: ConnectedClient,
  payload: { gameType: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  logger.info(
    { clientId: client.id, sessionId: client.sessionId, gameType: payload.gameType },
    'Starting game via user message'
  );

  // Send as a user message which will trigger the companion to use game_start tool
  const gameRequest = `Let's play ${payload.gameType.replace('_', ' ')}! You can go first.`;
  await handleUserMessage(client, { content: gameRequest });
}

/**
 * Handle user game move
 * Sends the move as a user message for the companion to process
 */
async function handleUserGameMove(
  client: ConnectedClient,
  payload: { move: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  logger.debug(
    { clientId: client.id, sessionId: client.sessionId, move: payload.move },
    'User game move'
  );

  // Send as a user message - the orchestrator will process this as a game move
  const moveMessage = `[Game move: ${payload.move}]`;
  await handleUserMessage(client, { content: moveMessage });
}

/**
 * Handle resign game request
 */
async function handleResignGame(client: ConnectedClient): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  logger.info(
    { clientId: client.id, sessionId: client.sessionId },
    'User resigning game'
  );

  // Send as a user message
  await handleUserMessage(client, { content: 'I resign from the game.' });
}

/**
 * Handle like message
 * Increments the like count for a specific turn and notifies the client
 */
async function handleLikeMessage(
  client: ConnectedClient,
  payload: { turnId: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId) {
    sendError(client, 'No active session');
    return;
  }

  try {
    const sessionsRepo = getSessionsRepository();

    // Increment the like count
    const { turnLikes, sessionLikes, contentSnippet } = await sessionsRepo.incrementTurnLikes(
      payload.turnId,
      client.sessionId
    );

    logger.debug(
      { clientId: client.id, turnId: payload.turnId, turnLikes, sessionLikes },
      'Message liked'
    );

    // Send acknowledgment to client
    send(client, {
      type: 'like_acknowledged',
      payload: {
        turnId: payload.turnId,
        turnLikes,
        sessionLikes,
        contentSnippet,
      },
    });
  } catch (error) {
    logger.error({ err: error, clientId: client.id, turnId: payload.turnId }, 'Failed to like message');
    sendError(client, error instanceof Error ? error.message : 'Failed to like message');
  }
}

/**
 * Theme colors for group chat participants
 */
const GROUP_THEME_COLORS = [
  '#8B5CF6', // Purple (primary)
  '#EC4899', // Pink
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
];

/**
 * Get theme color for participant by index
 */
function getThemeColorForIndex(index: number): string {
  return GROUP_THEME_COLORS[index % GROUP_THEME_COLORS.length] || '#8B5CF6';
}

/**
 * Handle invite companion (user-initiated via UI)
 * Used when user manually invites a friend to the session
 */
async function handleInviteCompanion(
  client: ConnectedClient,
  payload: { friendCompanionId: string; reason?: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  const { friendCompanionId, reason } = payload;
  const userId = client.user.userId;
  const sessionId = client.sessionId;

  try {
    const sessionsService = getSessionsService();
    const companionsService = getCompanionsService();

    // Check max participants
    if (client.groupParticipants.size >= 5) {
      sendError(client, 'Maximum of 5 participants allowed in group chat');
      return;
    }

    // Check if already a participant
    if (client.groupParticipants.has(friendCompanionId)) {
      sendError(client, 'Companion is already in the chat');
      return;
    }

    // Get friend companion details with avatar
    const friendCompanionWithAvatar = await companionsService.getWithAvatar(userId, friendCompanionId);
    if (!friendCompanionWithAvatar) {
      sendError(client, 'Friend companion not found');
      return;
    }

    // CompanionWithAvatar extends Companion, so we can use it directly
    const friendCompanion = friendCompanionWithAvatar;
    const friendAvatarUrl = friendCompanionWithAvatar.activeAvatar?.asset_url || null;

    // Add to session participants
    await sessionsService.inviteCompanion(userId, sessionId, friendCompanionId, client.companionId);

    // Add to local state
    const themeColor = getThemeColorForIndex(client.groupParticipants.size);
    const participantInfo: GroupParticipantInfo = {
      companionId: friendCompanionId,
      companionName: friendCompanion.name,
      avatarUrl: friendAvatarUrl,
      role: 'invited',
      themeColor,
      joinedAt: new Date(),
    };
    client.groupParticipants.set(friendCompanionId, participantInfo);
    client.isGroupChat = client.groupParticipants.size > 1;

    logger.info(
      { sessionId, friendCompanionId, friendName: friendCompanion.name, reason },
      'Companion invited to group chat'
    );

    // Notify client
    send(client, {
      type: 'companion_joined',
      payload: {
        companion: {
          companionId: friendCompanionId,
          companionName: friendCompanion.name,
          avatarUrl: friendAvatarUrl,
          role: 'invited',
          themeColor,
          joinedAt: new Date().toISOString(),
        },
        invitedByCompanionId: client.companionId,
        reason: reason || 'Joined the conversation',
        participants: Array.from(client.groupParticipants.values()).map(p => ({
          companionId: p.companionId,
          companionName: p.companionName,
          avatarUrl: p.avatarUrl,
          role: p.role,
          themeColor: p.themeColor,
          joinedAt: p.joinedAt.toISOString(),
        })),
      },
    });

    // Send group chat state update
    send(client, {
      type: 'group_chat_state',
      payload: {
        isGroupChat: client.isGroupChat,
        hostCompanionId: client.companionId,
        participants: Array.from(client.groupParticipants.values()).map(p => ({
          companionId: p.companionId,
          companionName: p.companionName,
          avatarUrl: p.avatarUrl,
          role: p.role,
          themeColor: p.themeColor,
          joinedAt: p.joinedAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    logger.error({ err: error, clientId: client.id, friendCompanionId }, 'Failed to invite companion');
    sendError(client, error instanceof Error ? error.message : 'Failed to invite companion');
  }
}

/**
 * Handle dismiss companion (remove from group chat)
 */
async function handleDismissCompanion(
  client: ConnectedClient,
  payload: { companionId: string }
): Promise<void> {
  if (!client.authenticated || !client.user) {
    sendError(client, 'Authentication required');
    return;
  }

  if (!client.sessionId || !client.companionId) {
    sendError(client, 'No active session');
    return;
  }

  const { companionId: targetCompanionId } = payload;
  const userId = client.user.userId;
  const sessionId = client.sessionId;

  // Cannot dismiss the primary companion
  if (targetCompanionId === client.companionId) {
    sendError(client, 'Cannot dismiss the primary companion');
    return;
  }

  // Check if participant exists
  const participant = client.groupParticipants.get(targetCompanionId);
  if (!participant) {
    sendError(client, 'Companion is not in the chat');
    return;
  }

  try {
    const sessionsService = getSessionsService();

    // Remove from session participants
    await sessionsService.dismissCompanion(userId, sessionId, targetCompanionId);

    // Remove from local state
    client.groupParticipants.delete(targetCompanionId);
    client.isGroupChat = client.groupParticipants.size > 1;

    logger.info(
      { sessionId, companionId: targetCompanionId, companionName: participant.companionName },
      'Companion dismissed from group chat'
    );

    // Notify client
    send(client, {
      type: 'companion_left',
      payload: {
        companionId: targetCompanionId,
        companionName: participant.companionName,
        reason: 'dismissed',
        participants: Array.from(client.groupParticipants.values()).map(p => ({
          companionId: p.companionId,
          companionName: p.companionName,
          avatarUrl: p.avatarUrl,
          role: p.role,
          themeColor: p.themeColor,
          joinedAt: p.joinedAt.toISOString(),
        })),
      },
    });

    // Send group chat state update
    send(client, {
      type: 'group_chat_state',
      payload: {
        isGroupChat: client.isGroupChat,
        hostCompanionId: client.companionId,
        participants: Array.from(client.groupParticipants.values()).map(p => ({
          companionId: p.companionId,
          companionName: p.companionName,
          avatarUrl: p.avatarUrl,
          role: p.role,
          themeColor: p.themeColor,
          joinedAt: p.joinedAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    logger.error({ err: error, clientId: client.id, companionId: targetCompanionId }, 'Failed to dismiss companion');
    sendError(client, error instanceof Error ? error.message : 'Failed to dismiss companion');
  }
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

  // Signal end of audio (will buffer if WS still connecting)
  voiceService.endSTTAudio(client.id);

  // Wait for STT session to finish (WS may still be connecting + processing)
  // Poll until session is gone (closed by ElevenLabs after processing) or timeout
  const maxWait = 15000; // 15 seconds max (WS connect can take 7s + processing time)
  const pollInterval = 200;
  let waited = 0;
  while (waited < maxWait && voiceService.hasSTTSession(client.id)) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }

  // Force stop if still running after timeout
  if (voiceService.hasSTTSession(client.id)) {
    await voiceService.stopSTTSession(client.id);
  }

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
function sendError(client: ConnectedClient, message: string, code?: string): void {
  send(client, {
    type: 'error',
    payload: { message, code },
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
