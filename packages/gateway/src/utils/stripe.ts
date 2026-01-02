/**
 * Stripe Client Singleton
 * Provides a single instance of the Stripe client for payment processing.
 */

import Stripe from 'stripe';
import { logger } from '../observability/logger.js';

let stripeInstance: Stripe | null = null;

/**
 * Get or create the Stripe client instance.
 * Uses singleton pattern to ensure one client per process.
 */
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env['STRIPE_SECRET_KEY'];
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });

    logger.info('Stripe client initialized');
  }
  return stripeInstance;
}

/**
 * Check if Stripe is configured (has API key).
 */
export function isStripeConfigured(): boolean {
  return !!process.env['STRIPE_SECRET_KEY'];
}
