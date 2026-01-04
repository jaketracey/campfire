/**
 * Tokens API
 * Token balance and purchase operations.
 */

import { get, post } from './client';

/**
 * Token balance information
 */
export interface TokenBalance {
  balance: number;
  lifetimePurchased: number;
  lifetimeBonus: number;
  lifetimeSpent: number;
}

/**
 * Token bundle available for purchase
 */
export interface TokenBundle {
  id: string;
  name: string;
  tokens: number;
  priceCents: number;
  bonusTokens: number;
  stripeProductId: string;
  isPopular?: boolean;
}

/**
 * Token bundles list response
 */
export interface TokenBundlesResponse {
  success: boolean;
  data: TokenBundle[];
}

/**
 * Checkout session response
 */
export interface CheckoutSessionResponse {
  url: string;
}

/**
 * Get current user's token balance
 */
export async function getTokenBalance(): Promise<TokenBalance> {
  return get<TokenBalance>('/gifts/tokens/balance');
}

/**
 * Get available token bundles for purchase
 */
export async function getTokenBundles(): Promise<TokenBundle[]> {
  const response = await get<TokenBundlesResponse>('/gifts/tokens/bundles');
  return response?.data ?? [];
}

/**
 * Create a Stripe checkout session for purchasing tokens
 */
export async function createTokenCheckout(
  bundleId: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string }> {
  return post<CheckoutSessionResponse>('/gifts/tokens/checkout', {
    bundleId,
    successUrl,
    cancelUrl,
  });
}
