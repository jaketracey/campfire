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
import { sessionsRoutes } from './sessions.js';
import { memoriesRoutes } from './memories.js';
import { eventsRoutes } from './events.js';
import { billingRoutes } from './billing.js';
import { emailWebhookRoutes } from './email-webhooks.js';
import { imagegenRoutes } from './imagegen.js';
import { debugRoutes } from './debug.js';
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

      // Session routes
      await api.register(sessionsRoutes, { prefix: '/sessions' });

      // Memory routes
      await api.register(memoriesRoutes, { prefix: '/memories' });

      // Event stream routes
      await api.register(eventsRoutes, { prefix: '/events' });

      // Billing routes
      await api.register(billingRoutes, { prefix: '/billing' });

      // Image generation routes
      await api.register(imagegenRoutes, { prefix: '/imagegen' });

      // Debug routes (admin/dev tools)
      await api.register(debugRoutes, { prefix: '/debug' });
    },
    { prefix: '/api/v1' }
  );

  // Webhook routes (at root level for external services)
  await app.register(emailWebhookRoutes, { prefix: '/webhooks/email' });

  logger.info('All API routes registered');
}
