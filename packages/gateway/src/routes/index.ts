/**
 * Route Registration
 * Registers all API routes on the Fastify instance.
 */

import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { usersRoutes } from './users.js';
import { adminRoutes } from './admin.js';
import { referralsRoutes } from './referrals.js';
import { companionsRoutes } from './companions.js';
import { companionFriendsRoutes } from './companion-friends.js';
import { sessionsRoutes } from './sessions.js';
import { memoriesRoutes } from './memories.js';
import { knowledgeGraphRoutes } from './knowledge-graph.js';
import { eventsRoutes } from './events.js';
import { billingRoutes } from './billing.js';
import { giftsRoutes } from './gifts.js';
import { emailWebhookRoutes } from './email-webhooks.js';
import { imagegenRoutes } from './imagegen.js';
import { debugRoutes } from './debug.js';
import { personalityProfilesRoutes } from './personality-profiles.js';
import { tenetsRoutes } from './tenets.js';
import { demoRoutes } from './demo.js';
import { adminOrchestrationRoutes } from './admin-orchestration.js';
import { adminCostsRoutes, userCostsRoutes } from './admin-costs.js';
import { voiceRoutes } from './voice.js';
import { logger } from '../observability/logger.js';

/**
 * Register all API routes
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // API v1 routes
  await app.register(
    async (api) => {
      // Authentication routes
      await api.register(authRoutes, { prefix: '/auth' });

      // User management routes
      await api.register(usersRoutes, { prefix: '/users' });

      // Admin routes
      await api.register(adminRoutes, { prefix: '/admin' });

      // Referral routes
      await api.register(referralsRoutes, { prefix: '/referrals' });

      // Companion routes
      await api.register(companionsRoutes, { prefix: '/companions' });

      // Companion friends routes (nested under /companions)
      await api.register(companionFriendsRoutes, { prefix: '/companions' });

      // Session routes
      await api.register(sessionsRoutes, { prefix: '/sessions' });

      // Memory routes
      await api.register(memoriesRoutes, { prefix: '/memories' });

      // Knowledge graph routes
      await api.register(knowledgeGraphRoutes, { prefix: '/knowledge-graph' });

      // Event stream routes
      await api.register(eventsRoutes, { prefix: '/events' });

      // Billing routes
      await api.register(billingRoutes, { prefix: '/billing' });

      // Gifts routes
      await api.register(giftsRoutes, { prefix: '/gifts' });

      // Image generation routes
      await api.register(imagegenRoutes, { prefix: '/imagegen' });

      // Debug routes (admin/dev tools)
      await api.register(debugRoutes, { prefix: '/debug' });

      // Personality profile routes (registered at root since they use /users and /admin prefixes)
      await api.register(personalityProfilesRoutes);

      // Demo routes (public, no auth required)
      await api.register(demoRoutes, { prefix: '/demo' });

      // Voice routes (public, for voice preview/selection)
      await api.register(voiceRoutes, { prefix: '/voice' });

      // Admin orchestration routes
      await api.register(adminOrchestrationRoutes, { prefix: '/admin/orchestration' });

      // Admin cost routes
      await api.register(adminCostsRoutes, { prefix: '/admin/costs' });

      // User cost routes (nested under /users/me)
      await api.register(userCostsRoutes, { prefix: '/users/me' });
    },
    { prefix: '/api/v1' }
  );

  // Webhook routes (at root level for external services)
  await app.register(emailWebhookRoutes, { prefix: '/webhooks/email' });

  // Internal routes (for service-to-service communication)
  // Tenets routes include both /internal/companions/:id/tenets/* and /companions/:id/tenets/*
  await app.register(tenetsRoutes);

  logger.info('All API routes registered');
}
