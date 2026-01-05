/**
 * Personality Profiles Routes
 * User personality profile management and analysis.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getPersonalityProfilesRepository,
  type PreferredTone,
  type VerbosityLevel,
  type GreetingStyle,
} from '../repositories/personality-profiles.js';
import { getSessionsRepository } from '../repositories/sessions.js';
import { logger } from '../observability/logger.js';

interface OrchestratorConfig {
  baseUrl: string;
}

/**
 * Analysis response from the orchestrator
 */
interface AnalysisResponse {
  traits?: {
    warmth?: number | null;
    energy?: number | null;
    humor?: number | null;
    formality?: number | null;
    curiosity?: number | null;
    openness?: number | null;
  };
  preferred_tone?: PreferredTone | null;
  verbosity?: VerbosityLevel | null;
  personality_insights?: string[];
  detected_interests?: string[];
  conversation_themes?: string[];
  greeting_style?: GreetingStyle;
  custom_insight?: string | null;
}

/**
 * Register personality profile routes
 */
export async function personalityProfilesRoutes(app: FastifyInstance): Promise<void> {
  const profileRepo = getPersonalityProfilesRepository();
  const sessionsRepo = getSessionsRepository();

  // Get orchestrator URL from environment
  const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:8000';

  /**
   * GET /users/:userId/personality-profile - Get user's personality profile
   */
  app.get(
    '/users/:userId/personality-profile',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };

      // Users can only view their own profile unless admin
      if (request.user?.role !== 'admin' && request.user?.userId !== userId) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You can only view your own personality profile',
        });
      }

      const profile = await profileRepo.findByUserId(userId);

      if (!profile) {
        return reply.send(null);
      }

      return reply.send({
        id: profile.id,
        userId: profile.userId,
        analysisVersion: profile.analysisVersion,
        turnsAnalyzed: profile.turnsAnalyzed,
        lastAnalysisAt: profile.lastAnalysisAt,
        nextAnalysisThreshold: profile.nextAnalysisThreshold,
        traits: {
          warmth: profile.warmth,
          energy: profile.energy,
          humor: profile.humor,
          formality: profile.formality,
          curiosity: profile.curiosity,
          openness: profile.openness,
        },
        preferredTone: profile.preferredTone,
        verbosity: profile.verbosity,
        personalityInsights: profile.personalityInsights,
        detectedInterests: profile.detectedInterests,
        conversationThemes: profile.conversationThemes,
        greetingStyle: profile.greetingStyle,
        customInsight: profile.customInsight,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      });
    }
  );

  /**
   * POST /users/:userId/personality-profile/refresh - Trigger manual re-analysis
   */
  app.post(
    '/users/:userId/personality-profile/refresh',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };

      // Users can only refresh their own profile unless admin
      if (request.user?.role !== 'admin' && request.user?.userId !== userId) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You can only refresh your own personality profile',
        });
      }

      try {
        // Get recent turns for analysis - use list() to get sessions for any companion
        const sessionsResult = await sessionsRepo.list({ userId, limit: 10 });
        const turns: { user_message: string; agent_message?: string }[] = [];

        for (const session of sessionsResult.data) {
          const sessionTurns = await sessionsRepo.listTurns({
            sessionId: session.id,
            limit: 50,
          });

          for (const turn of sessionTurns.data) {
            if (turn.user_message) {
              turns.push({
                user_message: turn.user_message,
                agent_message: turn.agent_message ?? undefined,
              });
            }
          }
        }

        if (turns.length < 10) {
          return reply.status(400).send({
            error: 'Insufficient Data',
            message: 'Need at least 10 conversation turns to generate a personality profile',
          });
        }

        // Get existing profile if any
        const existingProfile = await profileRepo.findByUserId(userId);

        // Call orchestrator to analyze personality
        const response = await fetch(`${orchestratorUrl}/profile/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            turns: turns.slice(0, 100), // Limit to last 100 turns
            existing_profile: existingProfile
              ? {
                  traits: {
                    warmth: existingProfile.warmth,
                    energy: existingProfile.energy,
                    humor: existingProfile.humor,
                    formality: existingProfile.formality,
                    curiosity: existingProfile.curiosity,
                    openness: existingProfile.openness,
                  },
                  preferredTone: existingProfile.preferredTone,
                  greetingStyle: existingProfile.greetingStyle,
                }
              : null,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          logger.error({ userId, error }, 'Orchestrator analysis failed');
          return reply.status(500).send({
            error: 'Analysis Failed',
            message: 'Failed to analyze personality profile',
          });
        }

        const analysis = (await response.json()) as AnalysisResponse;

        // Upsert the profile
        const profile = await profileRepo.upsert(userId, {
          userId,
          turnsAnalyzed: turns.length,
          nextAnalysisThreshold: turns.length + 50,
          warmth: analysis.traits?.warmth ?? null,
          energy: analysis.traits?.energy ?? null,
          humor: analysis.traits?.humor ?? null,
          formality: analysis.traits?.formality ?? null,
          curiosity: analysis.traits?.curiosity ?? null,
          openness: analysis.traits?.openness ?? null,
          preferredTone: analysis.preferred_tone ?? null,
          verbosity: analysis.verbosity ?? null,
          personalityInsights: analysis.personality_insights ?? [],
          detectedInterests: analysis.detected_interests ?? [],
          conversationThemes: analysis.conversation_themes ?? [],
          greetingStyle: analysis.greeting_style ?? 'friendly',
          customInsight: analysis.custom_insight ?? null,
        });

        logger.info({ userId, turnsAnalyzed: turns.length }, 'Personality profile refreshed');

        return reply.send({
          id: profile.id,
          userId: profile.userId,
          analysisVersion: profile.analysisVersion,
          turnsAnalyzed: profile.turnsAnalyzed,
          lastAnalysisAt: profile.lastAnalysisAt,
          traits: {
            warmth: profile.warmth,
            energy: profile.energy,
            humor: profile.humor,
            formality: profile.formality,
            curiosity: profile.curiosity,
            openness: profile.openness,
          },
          preferredTone: profile.preferredTone,
          greetingStyle: profile.greetingStyle,
          customInsight: profile.customInsight,
          personalityInsights: profile.personalityInsights,
          detectedInterests: profile.detectedInterests,
          conversationThemes: profile.conversationThemes,
        });
      } catch (error) {
        logger.error({ userId, error: String(error) }, 'Personality profile refresh error');
        return reply.status(500).send({
          error: 'Internal Error',
          message: 'Failed to refresh personality profile',
        });
      }
    }
  );

  /**
   * GET /admin/personality-profiles - List all personality profiles (admin only)
   */
  app.get(
    '/admin/personality-profiles',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

      const result = await profileRepo.listAll({
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });

      return reply.send({
        profiles: result.data.map((profile) => ({
          id: profile.id,
          userId: profile.userId,
          turnsAnalyzed: profile.turnsAnalyzed,
          lastAnalysisAt: profile.lastAnalysisAt,
          greetingStyle: profile.greetingStyle,
          customInsight: profile.customInsight,
          traits: {
            warmth: profile.warmth,
            energy: profile.energy,
            humor: profile.humor,
            formality: profile.formality,
            curiosity: profile.curiosity,
            openness: profile.openness,
          },
        })),
        hasMore: result.hasMore,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
    }
  );

  /**
   * GET /admin/personality-profiles/:userId - Get specific user's profile (admin only)
   */
  app.get(
    '/admin/personality-profiles/:userId',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };

      const profile = await profileRepo.findByUserId(userId);

      if (!profile) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Personality profile not found',
        });
      }

      return reply.send({
        id: profile.id,
        userId: profile.userId,
        analysisVersion: profile.analysisVersion,
        turnsAnalyzed: profile.turnsAnalyzed,
        lastAnalysisAt: profile.lastAnalysisAt,
        nextAnalysisThreshold: profile.nextAnalysisThreshold,
        traits: {
          warmth: profile.warmth,
          energy: profile.energy,
          humor: profile.humor,
          formality: profile.formality,
          curiosity: profile.curiosity,
          openness: profile.openness,
        },
        preferredTone: profile.preferredTone,
        verbosity: profile.verbosity,
        personalityInsights: profile.personalityInsights,
        detectedInterests: profile.detectedInterests,
        conversationThemes: profile.conversationThemes,
        greetingStyle: profile.greetingStyle,
        customInsight: profile.customInsight,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      });
    }
  );

  /**
   * GET /admin/personality-profiles/needs-analysis - Get users needing analysis (admin only)
   */
  app.get(
    '/admin/personality-profiles/needs-analysis',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const users = await profileRepo.getUsersNeedingAnalysis();

      return reply.send({
        users: users.map((u) => ({
          userId: u.userId,
          totalTurns: u.totalTurns,
          currentThreshold: u.currentThreshold,
        })),
        count: users.length,
      });
    }
  );
}
