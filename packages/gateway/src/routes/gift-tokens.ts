/**
 * Gift Token Routes
 * Token balance, bundles, purchase sessions, and Flowguard postbacks.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../observability/logger.js';
import { env } from '../env.js';
import { withSpan } from '../observability/tracing.js';
import { getGiftsRepository } from '../repositories/gifts.js';
import { getEventStore } from '../db/event-store.js';
import {
  isFlowguardConfigured,
  startPurchaseSession,
  verifyPostbackSignature,
  parsePostback,
  type FlowguardPostback,
} from '../utils/flowguard.js';

// ============================================================================
// Request Schemas
// ============================================================================

const CreateSessionSchema = z.object({
  bundleId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * Register gift token routes
 */
export async function giftTokensRoutes(app: FastifyInstance): Promise<void> {
  const giftsRepo = getGiftsRepository();
  const eventStore = getEventStore();

  // ==========================================================================
  // Token Endpoints (User-facing)
  // ==========================================================================

  /**
   * GET /gifts/tokens/balance - Get user's token balance
   */
  app.get('/tokens/balance', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.getTokenBalance', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const balance = await giftsRepo.getOrCreateTokenBalance(user.userId);

      return reply.send({
        success: true,
        data: {
          balance: balance.balance,
          lifetimePurchased: balance.lifetime_purchased,
          lifetimeBonus: balance.lifetime_bonus,
          lifetimeSpent: balance.lifetime_spent,
          currentPeriodBonus: balance.current_period_bonus,
          bonusGrantedAt: balance.bonus_granted_at?.toISOString() ?? null,
        },
      });
    });
  });

  /**
   * GET /gifts/tokens/bundles - Get available token bundles
   */
  app.get('/tokens/bundles', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTokenBundles', async () => {
      const bundles = await giftsRepo.listActiveBundles();

      return reply.send({
        success: true,
        data: bundles.map(bundle => ({
          id: bundle.id,
          name: bundle.name,
          description: bundle.description,
          tokens: bundle.tokens,
          priceCents: bundle.price_cents,
          currency: bundle.currency,
          bonusTokens: bundle.bonus_tokens,
          totalTokens: bundle.tokens + bundle.bonus_tokens,
          displayOrder: bundle.display_order,
        })),
      });
    });
  });

  /**
   * POST /gifts/tokens/session - Create Flowguard purchase session for token purchase
   * Returns a sessionId for use with the Flowguard frontend SDK.
   */
  app.post('/tokens/session', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.createTokenSession', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const parseResult = CreateSessionSchema.safeParse(request.body);
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

      const { bundleId, successUrl, cancelUrl } = parseResult.data;

      // Get bundle
      const bundle = await giftsRepo.findBundleById(bundleId);
      if (!bundle) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'BUNDLE_NOT_FOUND',
            message: 'Token bundle not found',
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (!bundle.is_active) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BUNDLE_INACTIVE',
            message: 'Token bundle is no longer available',
            timestamp: new Date().toISOString(),
          },
        });
      }

      logger.info({ userId: user.userId, bundleId, tokens: bundle.tokens }, 'Token session requested');

      // Check if Flowguard is configured
      if (!isFlowguardConfigured()) {
        logger.error('Flowguard is not configured - FLOWGUARD_SHOP_ID or FLOWGUARD_SIGNATURE_KEY missing');
        return reply.status(503).send({
          success: false,
          error: {
            code: 'PAYMENT_UNAVAILABLE',
            message: 'Payment processing is not available',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const totalTokens = bundle.tokens + bundle.bonus_tokens;

      // Create Flowguard purchase session
      const referenceId = `tok_${nanoid()}`;
      const apiBaseUrl = env.API_BASE_URL;
      const postbackUrl = `${apiBaseUrl}/api/v1/gifts/tokens/postback`;
      const session = await startPurchaseSession({
        priceAmount: (bundle.price_cents / 100).toFixed(2), // Format as "NNN.NN"
        priceCurrency: bundle.currency.toUpperCase(),
        description: `${bundle.name} - ${totalTokens} tokens`,
        referenceId,
        custom1: user.userId,
        custom2: bundleId,
        custom3: totalTokens.toString(),
        successUrl,
        declineUrl: cancelUrl,
        postbackUrl,
        email: user.email,
      });

      span.setAttributes({
        'flowguard.session_id': session.sessionId,
        'flowguard.reference_id': referenceId,
        'bundle.tokens': bundle.tokens,
        'bundle.bonus_tokens': bundle.bonus_tokens,
      });

      // Emit session started event
      const sessionTraceId = crypto.randomUUID();
      await eventStore.append({
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.userId,
        sessionId: null,
        turnId: null,
        traceId: sessionTraceId,
        type: 'gifts.session_started',
        payload: {
          bundleId,
          tokens: bundle.tokens,
          bonusTokens: bundle.bonus_tokens,
          priceCents: bundle.price_cents,
          flowguardSessionId: session.sessionId,
          referenceId,
        },
        version: '1.0',
        causationId: null,
        correlationId: sessionTraceId,
      });

      logger.info(
        { userId: user.userId, bundleId, flowguardSessionId: session.sessionId, totalTokens },
        'Flowguard purchase session created'
      );

      // Return sessionId for frontend SDK (no redirect URL - inline payment form)
      return reply.status(201).send({
        success: true,
        data: {
          sessionId: session.sessionId,
          referenceId,
          bundle: {
            id: bundle.id,
            name: bundle.name,
            tokens: bundle.tokens,
            bonusTokens: bundle.bonus_tokens,
            totalTokens,
            priceCents: bundle.price_cents,
          },
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      });
    });
  });

  /**
   * GET /gifts/tokens/transactions - List user's token transactions
   */
  app.get('/tokens/transactions', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.listTokenTransactions', async (span) => {
      const user = request.user!;
      span.setAttributes({ 'user.id': user.userId });

      const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };

      const result = await giftsRepo.listTokenTransactions(user.userId, {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset),
      });

      return reply.send({
        success: true,
        data: {
          items: result.data.map(tx => ({
            id: tx.id,
            type: tx.transaction_type,
            amount: tx.amount,
            balanceAfter: tx.balance_after,
            description: tx.description,
            giftId: tx.gift_id,
            createdAt: tx.created_at.toISOString(),
          })),
          hasMore: result.hasMore,
        },
      });
    });
  });

  /**
   * POST /gifts/tokens/postback - Handle Flowguard postback for token purchases
   * This endpoint receives postbacks from Flowguard when a purchase completes.
   * It verifies the signature and credits tokens to the user's account.
   */
  app.post('/tokens/postback', async (request: FastifyRequest, reply: FastifyReply) => {
    return withSpan('gifts.handleTokenPostback', async (span) => {
      // Parse postback payload
      let postback: FlowguardPostback;
      try {
        postback = parsePostback(request.body as Record<string, unknown>);
      } catch (error) {
        logger.warn({ error, body: request.body }, 'Invalid postback payload');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid postback payload',
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Verify signature
      if (!verifyPostbackSignature(postback)) {
        logger.warn({ transactionId: postback.transactionId }, 'Invalid postback signature');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Invalid postback signature',
            timestamp: new Date().toISOString(),
          },
        });
      }

      span.setAttributes({
        'flowguard.event': postback.event,
        'flowguard.transaction_id': postback.transactionId,
      });

      logger.info(
        { event: postback.event, transactionId: postback.transactionId, referenceId: postback.referenceId },
        'Token postback received'
      );

      // Handle purchase:completed event
      if (postback.event === 'purchase:completed') {
        // Extract metadata from custom fields
        const userId = postback.custom1;
        const bundleId = postback.custom2;
        const totalTokens = parseInt(postback.custom3 ?? '0', 10);

        if (!userId || !bundleId || totalTokens === 0) {
          logger.warn({ transactionId: postback.transactionId, custom1: postback.custom1, custom2: postback.custom2, custom3: postback.custom3 }, 'Missing metadata in postback');
          return reply.send({ received: true, status: 'OK' });
        }

        span.setAttributes({
          'user.id': userId,
          'bundle.id': bundleId,
          'tokens.total': totalTokens,
        });

        // Use transaction ID as idempotency key to prevent duplicate credits
        const idempotencyKey = `flowguard_${postback.transactionId}`;

        try {
          // Credit tokens using existing repository function
          const result = await giftsRepo.creditTokens(
            userId,
            totalTokens,
            'purchase',
            {
              flowguardSessionId: postback.referenceId,
              flowguardTransactionId: postback.transactionId,
              description: `Token purchase: ${totalTokens} tokens`,
              idempotencyKey,
              metadata: {
                bundleId,
                transactionId: postback.transactionId,
              },
            }
          );

          if (result.wasDuplicate) {
            logger.info(
              { userId, transactionId: postback.transactionId },
              'Duplicate token credit ignored (already processed)'
            );
          } else {
            logger.info(
              { userId, tokensAdded: totalTokens, newBalance: result.newBalance, transactionId: result.transactionId },
              'Tokens credited from Flowguard purchase'
            );

            // Emit event for audit trail
            const eventTraceId = crypto.randomUUID();
            await eventStore.append({
              eventId: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              userId,
              sessionId: null,
              turnId: null,
              traceId: eventTraceId,
              type: 'gifts.tokens_purchased',
              payload: {
                bundleId,
                tokensAdded: totalTokens,
                newBalance: result.newBalance,
                transactionId: result.transactionId,
                flowguardTransactionId: postback.transactionId,
                flowguardReferenceId: postback.referenceId,
              },
              version: '1.0',
              causationId: null,
              correlationId: postback.transactionId,
            });
          }
        } catch (error) {
          logger.error(
            { error, userId, transactionId: postback.transactionId },
            'Failed to credit tokens from postback'
          );
          // Return 200 to acknowledge receipt - Flowguard will retry if we return error
          // But we log the error for manual investigation
        }
      }

      // Acknowledge receipt - Flowguard expects "OK" response
      return reply.send({ received: true, status: 'OK' });
    });
  });
}
