/**
 * Flowguard API Types
 * Type definitions for Verotel/YoursAfe Flowguard payment integration.
 */

// ============================================================================
// Configuration
// ============================================================================

export interface FlowguardConfig {
  shopId: string;
  signatureKey: string;
  baseUrl: string;
  apiUrl: string;
}

// ============================================================================
// Purchase Session Types
// ============================================================================

export interface FlowguardPurchaseRequest {
  /** Amount in cents */
  priceAmount: number;
  /** ISO 4217 currency code (e.g., 'USD', 'EUR') */
  priceCurrency: string;
  /** Description shown to customer */
  description: string;
  /** Unique reference ID for this purchase */
  referenceId: string;
  /** Custom data to include in postback */
  custom1?: string;
  custom2?: string;
  custom3?: string;
  /** URL to redirect on successful payment */
  successUrl: string;
  /** URL to redirect on declined/cancelled payment */
  declineUrl: string;
  /** Email of the customer */
  email?: string;
}

export interface FlowguardSubscriptionRequest {
  /** Subscription type: 'recurring' or 'one-click' */
  subscriptionType: 'recurring' | 'one-click';
  /** Period in format like '30 days', '1 month', '1 year' */
  period: string;
  /** Amount in cents */
  priceAmount: number;
  /** ISO 4217 currency code */
  priceCurrency: string;
  /** Description shown to customer */
  description: string;
  /** Unique reference ID for this subscription */
  referenceId: string;
  /** Trial amount in cents (0 for no trial) */
  trialAmount?: number;
  /** Trial period (e.g., '7 days') */
  trialPeriod?: string;
  /** Custom data to include in postback */
  custom1?: string;
  custom2?: string;
  custom3?: string;
  /** URL to redirect on successful payment */
  successUrl: string;
  /** URL to redirect on declined/cancelled payment */
  declineUrl: string;
  /** URL to receive postback notifications */
  postbackUrl?: string;
  /** Email of the customer */
  email?: string;
}

// ============================================================================
// Session Response Types
// ============================================================================

export interface FlowguardSessionResponse {
  /** Session ID to pass to frontend SDK */
  sessionId: string;
  /** Status of the session */
  status: 'created' | 'pending' | 'completed' | 'failed' | 'expired';
  /** Expiration time of the session */
  expiresAt?: string;
}

export interface FlowguardErrorResponse {
  error: string;
  code: string;
  message: string;
}

// ============================================================================
// Postback/Webhook Types
// ============================================================================

export type FlowguardEventType =
  | 'purchase'
  | 'purchase:completed'
  | 'subscription'
  | 'subscription:initial'
  | 'subscription:rebill'
  | 'subscription:cancel'
  | 'subscription:expire'
  | 'subscriptionrebill'
  | 'subscriptioncancel'
  | 'subscriptionexpire'
  | 'credit'
  | 'chargeback'
  | 'refund';

export interface FlowguardPostback {
  /** Event type */
  event: FlowguardEventType;
  /** Flowguard transaction ID */
  transactionId: string;
  /** Our reference ID from the original request */
  referenceId: string;
  /** Shop ID */
  shopId: string;
  /** Sale ID (for subscriptions, the original sale) */
  saleId?: string;
  /** Subscription ID for recurring payments */
  subscriptionId?: string;
  /** Amount in cents */
  priceAmount?: number;
  /** Currency code */
  priceCurrency?: string;
  /** Payment method used */
  paymentMethod?: string;
  /** Transaction type: 'sale', 'refund', 'chargeback' */
  type?: string;
  /** Custom data from original request */
  custom1?: string;
  custom2?: string;
  custom3?: string;
  /** Signature for verification */
  signature: string;
  /** Timestamp of the event */
  timestamp?: string;
  /** Parent transaction ID for rebills */
  parentId?: string;
  /** Email of the customer */
  email?: string;
  /** Truncated card number */
  truncatedPAN?: string;
}

// ============================================================================
// Subscription Status Types
// ============================================================================

export interface FlowguardSubscriptionStatus {
  subscriptionId: string;
  status: 'active' | 'cancelled' | 'expired' | 'suspended';
  nextRebillDate?: string;
  lastRebillDate?: string;
  priceAmount: number;
  priceCurrency: string;
  period: string;
}

// ============================================================================
// Cancel Subscription Types
// ============================================================================

export interface FlowguardCancelRequest {
  subscriptionId: string;
  reason?: string;
}

export interface FlowguardCancelResponse {
  success: boolean;
  subscriptionId: string;
  status: 'cancelled';
  cancelledAt: string;
}
