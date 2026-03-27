/**
 * Video Call Routes
 * REST API for managing live video calls with AI companions via LiveKit.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { AccessToken, VideoGrant } from 'livekit-server-sdk';
import { requireAuth } from '../middleware/auth.js';
import { getVideoCallsRepository } from '../repositories/video-calls.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getCompanionsRepository } from '../repositories/companions.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
/** Tokens deducted per second for video calls (2x voice rate) */
const VIDEO_CALL_TOKENS_PER_SECOND = 2;

/** Default avatar provider */
const DEFAULT_AVATAR_PROVIDER = 'simli';

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateVideoCallSchema = z.object({
  companionId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  avatarFaceId: z.string().max(255).optional(),
  videoQuality: z.enum(['low', 'medium', 'high']).optional(),
});

// ============================================================================
// Helpers
// ============================================================================

const ORCHESTRATOR_URL = env.ORCHESTRATOR_URL;

/** LiveKit env vars (optional, degrade gracefully if not set) */
function getLiveKitConfig(): { apiKey: string; apiSecret: string; wsUrl: string } | null {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const wsUrl = env.LIVEKIT_WS_URL;
  if (!apiKey || !apiSecret || !wsUrl) {
    return null;
  }
  return { apiKey, apiSecret, wsUrl };
}

/** Generate a unique room name for a video call */
function generateRoomName(sessionId?: string): string {
  const ts = Date.now();
  const suffix = sessionId ? sessionId.slice(0, 8) : nanoid(8);
  return `campfire-${suffix}-${ts}`;
}

/** Generate a LiveKit participant token */
async function generateParticipantToken(
  config: { apiKey: string; apiSecret: string },
  roomName: string,
  participantIdentity: string,
  participantName: string
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl: '2h',
  });

  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };
  token.addGrant(grant);

  return await token.toJwt();
}

/** Notify the orchestrator to spin up the AI video agent */
async function notifyOrchestratorStart(
  roomName: string,
  companionId: string,
  userId: string,
  avatarProvider: string,
  avatarFaceId: string | null,
  avatarUrl: string | null = null
): Promise<boolean> {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/video/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomName,
        companionId,
        userId,
        avatarProvider,
        avatarFaceId,
        avatarUrl,
      }),
    });
    return response.ok;
  } catch (error) {
    logger.error({ error, roomName }, 'Failed to notify orchestrator to start video agent');
    return false;
  }
}

/** Notify the orchestrator to tear down the AI video agent */
async function notifyOrchestratorEnd(roomName: string): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/video/rooms/${roomName}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error({ error, roomName }, 'Failed to notify orchestrator to stop video agent');
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function videoCallsRoutes(app: FastifyInstance): Promise<void> {
  const videoCallsRepo = getVideoCallsRepository();
  const giftsRepo = getGiftsRepository();
  const companionsRepo = getCompanionsRepository();

  /**
   * POST /video-calls - Start a new video call
   */
  app.post('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const parseResult = CreateVideoCallSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { companionId, sessionId, avatarFaceId, videoQuality } = parseResult.data;

    // Verify companion exists and user has access
    const companion = await companionsRepo.findById(companionId);
    if (!companion) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Companion not found',
      });
    }

    if (companion.user_id !== user.userId && !companion.is_public) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this companion',
      });
    }

    // Check no active video call exists for user
    const activeCall = await videoCallsRepo.findActiveByUser(user.userId);
    if (activeCall) {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'You already have an active video call',
        activeCallId: activeCall.id,
      });
    }

    // Check token balance (require at least 60 seconds worth)
    const minTokens = VIDEO_CALL_TOKENS_PER_SECOND * 60;
    const balance = await giftsRepo.getTokenBalance(user.userId);
    if (!balance || balance.balance < minTokens) {
      return reply.status(402).send({
        error: 'Insufficient Tokens',
        message: `Video calls require at least ${minTokens} tokens (1 minute). Current balance: ${balance?.balance ?? 0}`,
        required: minTokens,
        balance: balance?.balance ?? 0,
      });
    }

    // Check LiveKit is configured
    const lkConfig = getLiveKitConfig();
    if (!lkConfig) {
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Video calling is not currently available',
      });
    }

    // Generate room name and participant token
    const roomName = generateRoomName(sessionId);
    const participantToken = await generateParticipantToken(
      lkConfig,
      roomName,
      user.userId,
      user.email
    );

    // Create DB record
    const videoCall = await videoCallsRepo.create({
      user_id: user.userId,
      companion_id: companionId,
      session_id: sessionId ?? null,
      room_name: roomName,
      status: 'connecting',
      avatar_provider: DEFAULT_AVATAR_PROVIDER,
      avatar_face_id: avatarFaceId ?? null,
      started_at: new Date(),
      metadata: videoQuality ? { videoQuality } : null,
    });

    // Look up companion's anchor avatar for the video agent
    let companionAvatarUrl: string | null = null;
    try {
      const { sql: getSql } = await import('../db/pool.js');
      const db = getSql();
      const rows = await db`SELECT asset_url FROM companion_avatars WHERE companion_id = ${companionId} AND is_identity_anchor = true AND is_active = true LIMIT 1`;
      companionAvatarUrl = rows[0]?.asset_url ?? null;
    } catch { /* non-fatal */ }

    // Notify orchestrator to spin up AI agent (non-blocking)
    notifyOrchestratorStart(
      roomName,
      companionId,
      user.userId,
      DEFAULT_AVATAR_PROVIDER,
      avatarFaceId ?? null,
      companionAvatarUrl
    ).then((ok) => {
      if (!ok) {
        logger.warn({ videoCallId: videoCall.id, roomName }, 'Orchestrator failed to start video agent');
        // Mark call as failed if orchestrator cannot start the agent
        videoCallsRepo.updateStatus(videoCall.id, 'failed', {
          error: 'Failed to start AI video agent',
        }).catch((err) => {
          logger.error({ err, videoCallId: videoCall.id }, 'Failed to mark video call as failed');
        });
      }
    });

    logger.info(
      { videoCallId: videoCall.id, roomName, userId: user.userId, companionId },
      'Video call created'
    );

    return reply.status(201).send({
      videoCallId: videoCall.id,
      roomName,
      roomUrl: lkConfig.wsUrl,
      token: participantToken,
      status: videoCall.status,
    });
  });

  /**
   * POST /video-calls/:id/end - End a video call
   */
  app.post('/:id/end', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const videoCall = await videoCallsRepo.findById(id);
    if (!videoCall) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Video call not found',
      });
    }

    // Ownership check
    if (videoCall.user_id !== user.userId && user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this video call',
      });
    }

    if (videoCall.status === 'ended' || videoCall.status === 'failed') {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Video call is already ${videoCall.status}`,
      });
    }

    // Calculate duration
    const endedAt = new Date();
    const startedAt = videoCall.started_at ? new Date(videoCall.started_at) : videoCall.created_at;
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const tokensDeducted = videoCall.tokens_deducted;

    // End the call in DB
    const ended = await videoCallsRepo.endCall(
      id,
      endedAt,
      durationSeconds,
      tokensDeducted
    );

    // Signal orchestrator to tear down agent
    notifyOrchestratorEnd(videoCall.room_name);

    logger.info(
      { videoCallId: id, roomName: videoCall.room_name, durationSeconds, tokensDeducted },
      'Video call ended'
    );

    return reply.send({
      id: ended.id,
      status: ended.status,
      durationSeconds,
      tokensDeducted,
      endedAt: endedAt.toISOString(),
    });
  });

  /**
   * GET /video-calls/:id - Get call details
   */
  app.get('/:id', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const videoCall = await videoCallsRepo.findById(id);
    if (!videoCall) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Video call not found',
      });
    }

    if (videoCall.user_id !== user.userId && user.role !== 'admin') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have access to this video call',
      });
    }

    return reply.send({
      id: videoCall.id,
      userId: videoCall.user_id,
      companionId: videoCall.companion_id,
      sessionId: videoCall.session_id,
      roomName: videoCall.room_name,
      status: videoCall.status,
      avatarProvider: videoCall.avatar_provider,
      avatarFaceId: videoCall.avatar_face_id,
      startedAt: videoCall.started_at,
      endedAt: videoCall.ended_at,
      durationSeconds: videoCall.duration_seconds,
      tokensDeducted: videoCall.tokens_deducted,
      costUsd: videoCall.cost_usd,
      metadata: videoCall.metadata,
      createdAt: videoCall.created_at,
    });
  });

  /**
   * GET /video-calls/active - Get user's active video call
   */
  app.get('/active', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;

    const activeCall = await videoCallsRepo.findActiveByUser(user.userId);
    if (!activeCall) {
      return reply.send({ activeCall: null });
    }

    return reply.send({
      activeCall: {
        id: activeCall.id,
        companionId: activeCall.companion_id,
        roomName: activeCall.room_name,
        status: activeCall.status,
        startedAt: activeCall.started_at,
        tokensDeducted: activeCall.tokens_deducted,
        createdAt: activeCall.created_at,
      },
    });
  });

  /**
   * GET /video-calls - List user's call history (paginated)
   */
  app.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const {
      limit = '20',
      offset = '0',
      companionId,
      status,
    } = request.query as {
      limit?: string;
      offset?: string;
      companionId?: string;
      status?: string;
    };

    const result = await videoCallsRepo.listByUser({
      userId: user.userId,
      companionId,
      status: status as 'connecting' | 'active' | 'ending' | 'ended' | 'failed' | undefined,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      videoCalls: result.data.map((vc) => ({
        id: vc.id,
        companionId: vc.companion_id,
        roomName: vc.room_name,
        status: vc.status,
        startedAt: vc.started_at,
        endedAt: vc.ended_at,
        durationSeconds: vc.duration_seconds,
        tokensDeducted: vc.tokens_deducted,
        createdAt: vc.created_at,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });
}
