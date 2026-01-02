/**
 * Demo Routes
 * Public endpoints for anonymous demo/trial users.
 * These endpoints do NOT require authentication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../observability/logger.js';
import { getAnonymousUsageRepository } from '../repositories/anonymous-usage.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { getCompanionsRepository } from '../repositories/companions.js';

// System anonymous user ID
const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

// Request schemas
const CreateDemoSessionBodySchema = z.object({
  companionId: z.string().uuid(),
  fingerprint: z.string().min(1).max(64),
});

/**
 * Register demo routes (no authentication required)
 */
export async function demoRoutes(app: FastifyInstance): Promise<void> {
  const anonymousUsageRepo = getAnonymousUsageRepository();
  const sessionsRepo = getSessionsRepository();
  const companionsRepo = getCompanionsRepository();

  /**
   * GET /demo/companion
   * Returns a random companion with anchor image and backstory
   * Selects from ALL companions in the database that have the required data
   */
  app.get('/companion', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get a random companion that has both anchor image AND backstory
      const companion = await companionsRepo.getRandomWithAnchorAndBackstory();

      if (!companion) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NO_COMPANIONS_AVAILABLE',
            message: 'No companions are currently available for demo',
            timestamp: new Date().toISOString(),
          },
        });
      }

      logger.debug({ companionId: companion.id, companionName: companion.name }, 'Returning demo companion');

      return reply.send({
        success: true,
        data: {
          companion: {
            id: companion.id,
            name: companion.name,
            avatarUrl: companion.activeAvatar?.asset_url ?? null,
            // Include relevant spec info for the demo UI
            archetype: companion.spec?.personality?.archetype ?? null,
            description: (companion.spec?.identity as Record<string, unknown>)?.['selfDescription'] ?? null,
          },
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get demo companion');
      throw error;
    }
  });

  /**
   * POST /demo/session
   * Creates a session for an anonymous user
   * Tracks usage by fingerprint
   */
  app.post('/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateDemoSessionBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseResult.error.flatten(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const { companionId, fingerprint } = parseResult.data;

    try {
      // Verify the companion exists and is active
      const companion = await companionsRepo.findById(companionId);
      if (!companion || companion.status !== 'active') {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'INVALID_DEMO_COMPANION',
            message: 'This companion is not available for demo',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Get or create anonymous usage record
      const ipAddress = request.ip;
      const usage = await anonymousUsageRepo.getOrCreate(fingerprint, ipAddress);

      // Check for existing active session
      const existingSession = await sessionsRepo.findActiveSession(ANONYMOUS_USER_ID, companionId);
      if (existingSession) {
        // Update the anonymous usage with this session
        await anonymousUsageRepo.updateSession(fingerprint, existingSession.id);

        return reply.send({
          success: true,
          data: {
            session: {
              id: existingSession.id,
              companionId: existingSession.companion_id,
              status: existingSession.status,
              startedAt: existingSession.started_at.toISOString(),
            },
            usage: {
              messagesUsed: usage.messages_used,
              fingerprint: fingerprint,
            },
          },
        });
      }

      // Create a new session for the anonymous user
      const session = await sessionsRepo.create({
        user_id: ANONYMOUS_USER_ID,
        companion_id: companionId,
        status: 'active',
        metadata: {
          isAnonymous: true,
          fingerprint: fingerprint,
        },
      });

      // Update the anonymous usage with this session
      await anonymousUsageRepo.updateSession(fingerprint, session.id);

      logger.info(
        { sessionId: session.id, companionId, fingerprint: fingerprint.substring(0, 8) + '...' },
        'Demo session created'
      );

      return reply.status(201).send({
        success: true,
        data: {
          session: {
            id: session.id,
            companionId: session.companion_id,
            status: session.status,
            startedAt: session.started_at.toISOString(),
          },
          usage: {
            messagesUsed: usage.messages_used,
            fingerprint: fingerprint,
          },
        },
      });
    } catch (error) {
      logger.error({ err: error, companionId, fingerprint: fingerprint.substring(0, 8) + '...' }, 'Failed to create demo session');
      throw error;
    }
  });
}
