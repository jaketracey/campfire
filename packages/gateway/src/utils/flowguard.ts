/**
 * Flowguard Client
 * Verotel/YoursAfe Flowguard payment processing integration.
 * Uses JWT authentication for API calls and signature verification for postbacks.
 */

import * as jose from 'jose';
import crypto from 'crypto';
import { logger } from '../observability/logger.js';
import type {
  FlowguardConfig,
  FlowguardPurchaseRequest,
  FlowguardSubscriptionRequest,
  FlowguardSessionResponse,
  FlowguardPostback,
  FlowguardSubscriptionStatus,
  FlowguardCancelRequest,
  FlowguardCancelResponse,
} from './flowguard-types.js';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_BASE_URL = 'https://flowguard.yoursafe.com';
const DEFAULT_API_URL = 'https://api.yoursafe.com';

function getConfig(): FlowguardConfig {
  return {
    shopId: process.env['FLOWGUARD_SHOP_ID'] ?? '',
    signatureKey: process.env['FLOWGUARD_SIGNATURE_KEY'] ?? '',
    baseUrl: process.env['FLOWGUARD_BASE_URL'] ?? DEFAULT_BASE_URL,
    apiUrl: process.env['FLOWGUARD_API_URL'] ?? DEFAULT_API_URL,
  };
}

/**
 * Check if Flowguard is configured (has required credentials).
 */
export function isFlowguardConfigured(): boolean {
  const config = getConfig();
  return !!(config.shopId && config.signatureKey);
}

// ============================================================================
// JWT Generation
// ============================================================================

/**
 * Generate a JWT token for Flowguard API authentication.
 * Uses HS256 algorithm with the signatureKey.
 */
async function generateJWT(payload: Record<string, unknown>): Promise<string> {
  const config = getConfig();

  if (!config.signatureKey) {
    throw new Error('FLOWGUARD_SIGNATURE_KEY is required');
  }

  const secret = new TextEncoder().encode(config.signatureKey);

  const jwt = await new jose.SignJWT({
    shopId: config.shopId,
    ...payload,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);

  return jwt;
}

/**
 * Verify a JWT token from Flowguard.
 */
async function verifyJWT(token: string): Promise<jose.JWTPayload> {
  const config = getConfig();

  if (!config.signatureKey) {
    throw new Error('FLOWGUARD_SIGNATURE_KEY is required');
  }

  const secret = new TextEncoder().encode(config.signatureKey);

  const { payload } = await jose.jwtVerify(token, secret);
  return payload;
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify a postback signature from Flowguard.
 * The signature is calculated as SHA256(signatureKey + sortedParams).
 */
export function verifyPostbackSignature(postback: FlowguardPostback): boolean {
  const config = getConfig();

  if (!config.signatureKey) {
    logger.error('FLOWGUARD_SIGNATURE_KEY is required for signature verification');
    return false;
  }

  // Extract the signature from the postback
  const providedSignature = postback.signature;
  if (!providedSignature) {
    logger.warn('No signature provided in postback');
    return false;
  }

  // Create a copy without the signature for verification
  const paramsToSign: Record<string, string> = {};
  for (const [key, value] of Object.entries(postback)) {
    if (key !== 'signature' && value !== undefined && value !== null) {
      paramsToSign[key] = String(value);
    }
  }

  // Sort parameters alphabetically by key
  const sortedKeys = Object.keys(paramsToSign).sort();
  const signatureString = sortedKeys.map(key => `${key}=${paramsToSign[key]}`).join(':');

  // Calculate expected signature: SHA256(signatureKey + signatureString)
  const expectedSignature = crypto
    .createHash('sha256')
    .update(config.signatureKey + signatureString)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(providedSignature.toLowerCase()),
    Buffer.from(expectedSignature.toLowerCase())
  );

  if (!isValid) {
    logger.warn(
      { providedSignature, expectedSignature: expectedSignature.substring(0, 10) + '...' },
      'Postback signature verification failed'
    );
  }

  return isValid;
}

// ============================================================================
// API Client
// ============================================================================

/**
 * Make an authenticated API request to Flowguard.
 */
async function apiRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>
): Promise<T> {
  const config = getConfig();
  const token = await generateJWT(body ?? {});

  const url = `${config.apiUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText, endpoint }, 'Flowguard API error');
    throw new Error(`Flowguard API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Purchase Session
// ============================================================================

/**
 * Start a new purchase session for a one-time payment.
 * Returns a sessionId to use with the Flowguard frontend SDK.
 */
export async function startPurchaseSession(
  request: FlowguardPurchaseRequest
): Promise<FlowguardSessionResponse> {
  const config = getConfig();

  if (!isFlowguardConfigured()) {
    throw new Error('Flowguard is not configured');
  }

  logger.info(
    { referenceId: request.referenceId, amount: request.priceAmount, currency: request.priceCurrency },
    'Starting Flowguard purchase session'
  );

  const response = await apiRequest<FlowguardSessionResponse>('/flowguard/purchase/start', 'POST', {
    shopId: config.shopId,
    priceAmount: request.priceAmount,
    priceCurrency: request.priceCurrency,
    description: request.description,
    referenceId: request.referenceId,
    custom1: request.custom1,
    custom2: request.custom2,
    custom3: request.custom3,
    successUrl: request.successUrl,
    declineUrl: request.declineUrl,
    email: request.email,
  });

  logger.info(
    { sessionId: response.sessionId, referenceId: request.referenceId },
    'Flowguard purchase session created'
  );

  return response;
}

// ============================================================================
// Subscription Session
// ============================================================================

/**
 * Start a new subscription session for recurring payments.
 * Returns a sessionId to use with the Flowguard frontend SDK.
 */
export async function startSubscriptionSession(
  request: FlowguardSubscriptionRequest
): Promise<FlowguardSessionResponse> {
  const config = getConfig();

  if (!isFlowguardConfigured()) {
    throw new Error('Flowguard is not configured');
  }

  logger.info(
    {
      referenceId: request.referenceId,
      amount: request.priceAmount,
      currency: request.priceCurrency,
      period: request.period,
    },
    'Starting Flowguard subscription session'
  );

  const response = await apiRequest<FlowguardSessionResponse>('/flowguard/subscription/start', 'POST', {
    shopId: config.shopId,
    subscriptionType: request.subscriptionType,
    period: request.period,
    priceAmount: request.priceAmount,
    priceCurrency: request.priceCurrency,
    description: request.description,
    referenceId: request.referenceId,
    trialAmount: request.trialAmount,
    trialPeriod: request.trialPeriod,
    custom1: request.custom1,
    custom2: request.custom2,
    custom3: request.custom3,
    successUrl: request.successUrl,
    declineUrl: request.declineUrl,
    postbackUrl: request.postbackUrl,
    email: request.email,
  });

  logger.info(
    { sessionId: response.sessionId, referenceId: request.referenceId },
    'Flowguard subscription session created'
  );

  return response;
}

// ============================================================================
// Subscription Management
// ============================================================================

/**
 * Get the status of a subscription.
 */
export async function getSubscriptionStatus(
  subscriptionId: string
): Promise<FlowguardSubscriptionStatus> {
  if (!isFlowguardConfigured()) {
    throw new Error('Flowguard is not configured');
  }

  return apiRequest<FlowguardSubscriptionStatus>(
    `/flowguard/subscription/${subscriptionId}/status`,
    'GET'
  );
}

/**
 * Cancel a subscription.
 */
export async function cancelSubscription(
  request: FlowguardCancelRequest
): Promise<FlowguardCancelResponse> {
  if (!isFlowguardConfigured()) {
    throw new Error('Flowguard is not configured');
  }

  logger.info({ subscriptionId: request.subscriptionId }, 'Cancelling Flowguard subscription');

  const response = await apiRequest<FlowguardCancelResponse>(
    `/flowguard/subscription/${request.subscriptionId}/cancel`,
    'POST',
    { reason: request.reason }
  );

  logger.info(
    { subscriptionId: request.subscriptionId, status: response.status },
    'Flowguard subscription cancelled'
  );

  return response;
}

// ============================================================================
// Postback Parsing
// ============================================================================

/**
 * Parse and validate a postback from Flowguard.
 * Returns the parsed postback if valid, throws if invalid.
 */
export function parsePostback(body: Record<string, unknown>): FlowguardPostback {
  // Map the body to FlowguardPostback structure
  const postback: FlowguardPostback = {
    event: body['event'] as FlowguardPostback['event'],
    transactionId: body['transactionId'] as string,
    referenceId: body['referenceId'] as string,
    shopId: body['shopId'] as string,
    saleId: body['saleId'] as string | undefined,
    subscriptionId: body['subscriptionId'] as string | undefined,
    priceAmount: body['priceAmount'] ? Number(body['priceAmount']) : undefined,
    priceCurrency: body['priceCurrency'] as string | undefined,
    paymentMethod: body['paymentMethod'] as string | undefined,
    type: body['type'] as string | undefined,
    custom1: body['custom1'] as string | undefined,
    custom2: body['custom2'] as string | undefined,
    custom3: body['custom3'] as string | undefined,
    signature: body['signature'] as string,
    timestamp: body['timestamp'] as string | undefined,
    parentId: body['parentId'] as string | undefined,
    email: body['email'] as string | undefined,
    truncatedPAN: body['truncatedPAN'] as string | undefined,
  };

  // Validate required fields
  if (!postback.event) {
    throw new Error('Missing required field: event');
  }
  if (!postback.transactionId) {
    throw new Error('Missing required field: transactionId');
  }
  if (!postback.signature) {
    throw new Error('Missing required field: signature');
  }

  return postback;
}

// ============================================================================
// Exports for compatibility
// ============================================================================

export type {
  FlowguardConfig,
  FlowguardPurchaseRequest,
  FlowguardSubscriptionRequest,
  FlowguardSessionResponse,
  FlowguardPostback,
  FlowguardSubscriptionStatus,
  FlowguardCancelRequest,
  FlowguardCancelResponse,
  FlowguardEventType,
} from './flowguard-types.js';
