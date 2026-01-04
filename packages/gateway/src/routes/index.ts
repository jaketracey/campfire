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
import { supportRoutes, adminSupportRoutes } from './support.js';
import {
  adminProvidersRoutes,
  adminModelsRoutes,
  adminRoutingRoutes,
  adminCompanionRoutingRoutes,
} from './admin-providers.js';
import {
  adminImageProvidersRoutes,
  adminImageModelsRoutes,
  adminImageRoutingRoutes,
} from './admin-image-providers.js';
import { affiliateAuthRoutes } from './affiliate-auth.js';
import { affiliatePortalRoutes } from './affiliate-portal.js';
import { affiliateTrackingRoutes } from './affiliate-tracking.js';
import { adminAffiliatesRoutes } from './admin-affiliates.js';
import { adminAnalyticsRoutes } from './admin-analytics.js';
import { adminAdsRoutes } from './admin-ads.js';
import { videosRoutes, mediaRoutes } from './videos.js';
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

      // Companion tenets routes (paths include /companions/:id/tenets/*)
      await api.register(tenetsRoutes);

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

      // Video request routes
      await api.register(videosRoutes, { prefix: '/videos' });

      // Media gallery routes (images + videos)
      await api.register(mediaRoutes, { prefix: '/media' });

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

      // Support routes (user-facing)
      await api.register(supportRoutes, { prefix: '/support' });

      // Admin support routes
      await api.register(adminSupportRoutes, { prefix: '/admin/support' });

      // Admin provider settings routes (text/LLM)
      await api.register(adminProvidersRoutes, { prefix: '/admin/providers' });
      await api.register(adminModelsRoutes, { prefix: '/admin/models' });
      await api.register(adminRoutingRoutes, { prefix: '/admin/routing' });
      await api.register(adminCompanionRoutingRoutes, { prefix: '/admin/companions' });

      // Admin image provider settings routes
      await api.register(adminImageProvidersRoutes, { prefix: '/admin/image-providers' });
      await api.register(adminImageModelsRoutes, { prefix: '/admin/image-models' });
      await api.register(adminImageRoutingRoutes, { prefix: '/admin/image-routing' });

      // Affiliate routes
      await api.register(affiliateAuthRoutes, { prefix: '/affiliate/auth' });
      await api.register(affiliatePortalRoutes, { prefix: '/affiliate' });
      await api.register(affiliateTrackingRoutes, { prefix: '/affiliate' });

      // Admin affiliate routes
      await api.register(adminAffiliatesRoutes, { prefix: '/admin/affiliates' });

      // Admin analytics routes
      await api.register(adminAnalyticsRoutes, { prefix: '/admin/analytics' });

      // Admin ads routes
      await api.register(adminAdsRoutes, { prefix: '/admin/ads' });
    },
    { prefix: '/api/v1' }
  );

  // Affiliate tracking routes (at root level for short URLs)
  await app.register(affiliateTrackingRoutes);

  // Webhook routes (at root level for external services)
  await app.register(emailWebhookRoutes, { prefix: '/webhooks/email' });

  logger.info('All API routes registered');
}
