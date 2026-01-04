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
  totalTokens: number;
  description?: string;
  displayOrder?: number;
  currency?: string;
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
 * Payment session response from Flowguard
 */
export interface PaymentSessionResponse {
  sessionId: string;
  referenceId: string;
  bundle: {
    id: string;
    name: string;
    tokens: number;
    bonusTokens: number;
    totalTokens: number;
    priceCents: number;
  };
  expiresAt: string;
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
 * Create a Flowguard payment session for purchasing tokens.
 * Returns a sessionId for use with the Flowguard frontend SDK.
 */
export async function createTokenSession(
  bundleId: string,
  successUrl: string,
  cancelUrl: string
): Promise<PaymentSessionResponse> {
  return post<PaymentSessionResponse>('/gifts/tokens/session', {
    bundleId,
    successUrl,
    cancelUrl,
  });
}
