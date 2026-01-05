/**
 * Meta Pixel Analytics Utility
 * Type-safe wrapper for Facebook/Meta Pixel events
 */

// Extend Window interface for fbq
declare global {
  interface Window {
    fbq?: (
      action: 'track' | 'trackCustom' | 'init',
      event: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

// Standard Meta events that can be used for ad optimization
type StandardEvent =
  | 'Lead'
  | 'CompleteRegistration'
  | 'ViewContent'
  | 'InitiateCheckout'
  | 'AddPaymentInfo'
  | 'Purchase'
  | 'Subscribe';

// Custom events for funnel analysis
type CustomEvent =
  | 'StartOnboarding'
  | 'OnboardingStep'
  | 'SurpriseMe'
  | 'CompanionCreated'
  | 'OnboardingComplete'
  | 'ChatStarted'
  | 'FirstMessage'
  | 'GiftSent'
  | 'GiftPurchased';

// Parameter types for each event
interface LeadParams {
  content_name?: string;
  content_category?: 'email' | 'google';
}

interface CompleteRegistrationParams {
  content_name?: string;
  status?: string;
}

interface ViewContentParams {
  content_type?: string;
  content_ids?: string[];
  content_name?: string;
  value?: number;
  currency?: string;
}

interface InitiateCheckoutParams {
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  value?: number;
  currency?: string;
  num_items?: number;
}

interface AddPaymentInfoParams {
  content_ids?: string[];
  content_type?: string;
  value?: number;
  currency?: string;
}

interface PurchaseParams {
  content_ids?: string[];
  content_name?: string;
  content_type?: string;
  value: number;
  currency: string;
  num_items?: number;
}

interface SubscribeParams {
  value: number;
  currency: string;
  predicted_ltv?: number;
}

interface StartOnboardingParams {
  path: 'full' | 'quick';
}

interface OnboardingStepParams {
  step: number;
  stepName: string;
  path?: 'full' | 'quick';
}

interface CompanionCreatedParams {
  companionId: string;
}

interface OnboardingCompleteParams {
  path: 'full' | 'quick';
  totalSteps: number;
}

interface ChatStartedParams {
  sessionId: string;
  companionId: string;
}

interface FirstMessageParams {
  sessionId: string;
}

interface GiftSentParams {
  giftType: string;
  tokenCost: number;
  companionId: string;
}

interface GiftPurchasedParams {
  templateId: string;
  tokenCost: number;
}

// Map event names to their parameter types
interface EventParamsMap {
  Lead: LeadParams;
  CompleteRegistration: CompleteRegistrationParams;
  ViewContent: ViewContentParams;
  InitiateCheckout: InitiateCheckoutParams;
  AddPaymentInfo: AddPaymentInfoParams;
  Purchase: PurchaseParams;
  Subscribe: SubscribeParams;
  StartOnboarding: StartOnboardingParams;
  OnboardingStep: OnboardingStepParams;
  SurpriseMe: Record<string, never>;
  CompanionCreated: CompanionCreatedParams;
  OnboardingComplete: OnboardingCompleteParams;
  ChatStarted: ChatStartedParams;
  FirstMessage: FirstMessageParams;
  GiftSent: GiftSentParams;
  GiftPurchased: GiftPurchasedParams;
}

/**
 * Check if we're in a browser environment and fbq is available
 */
function isFbqAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.fbq === 'function';
}

/**
 * Track a standard Meta Pixel event
 * Standard events can be used for ad optimization and conversion tracking
 */
export function trackEvent<T extends StandardEvent>(
  event: T,
  params?: EventParamsMap[T]
): void {
  if (!isFbqAvailable()) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Meta Pixel] Would track:', event, params);
    }
    return;
  }

  window.fbq!('track', event, params as Record<string, unknown>);

  if (process.env.NODE_ENV === 'development') {
    console.log('[Meta Pixel] Tracked:', event, params);
  }
}

/**
 * Track a custom Meta Pixel event
 * Custom events are useful for funnel analysis and custom conversions
 */
export function trackCustomEvent<T extends CustomEvent>(
  event: T,
  params?: EventParamsMap[T]
): void {
  if (!isFbqAvailable()) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Meta Pixel] Would trackCustom:', event, params);
    }
    return;
  }

  window.fbq!('trackCustom', event, params as Record<string, unknown>);

  if (process.env.NODE_ENV === 'development') {
    console.log('[Meta Pixel] Tracked custom:', event, params);
  }
}

// Convenience functions for common events

/**
 * Track a successful signup (Lead event)
 */
export function trackSignup(provider: 'email' | 'google'): void {
  trackEvent('Lead', {
    content_name: 'signup',
    content_category: provider,
  });
}

/**
 * Track onboarding completion (CompleteRegistration event)
 */
export function trackOnboardingComplete(path: 'full' | 'quick', totalSteps: number): void {
  trackEvent('CompleteRegistration', {
    content_name: 'onboarding',
    status: 'completed',
  });
  trackCustomEvent('OnboardingComplete', { path, totalSteps });
}

/**
 * Track viewing token bundles (ViewContent event)
 */
export function trackViewTokenBundles(bundleIds: string[]): void {
  trackEvent('ViewContent', {
    content_type: 'product',
    content_ids: bundleIds,
    content_name: 'token_bundles',
  });
}

/**
 * Track starting a token purchase (InitiateCheckout event)
 */
export function trackInitiateCheckout(
  bundleId: string,
  bundleName: string,
  priceInCents: number
): void {
  trackEvent('InitiateCheckout', {
    content_ids: [bundleId],
    content_name: bundleName,
    content_type: 'tokens',
    value: priceInCents / 100,
    currency: 'USD',
    num_items: 1,
  });
}

/**
 * Track payment info submission (AddPaymentInfo event)
 */
export function trackAddPaymentInfo(bundleId: string, priceInCents: number): void {
  trackEvent('AddPaymentInfo', {
    content_ids: [bundleId],
    content_type: 'tokens',
    value: priceInCents / 100,
    currency: 'USD',
  });
}

/**
 * Track a completed purchase (Purchase event)
 */
export function trackPurchase(
  bundleId: string,
  bundleName: string,
  priceInCents: number
): void {
  trackEvent('Purchase', {
    content_ids: [bundleId],
    content_name: bundleName,
    content_type: 'tokens',
    value: priceInCents / 100,
    currency: 'USD',
    num_items: 1,
  });
}

/**
 * Track onboarding start
 */
export function trackStartOnboarding(path: 'full' | 'quick'): void {
  trackCustomEvent('StartOnboarding', { path });
}

/**
 * Track onboarding step completion
 */
export function trackOnboardingStep(
  step: number,
  stepName: string,
  path?: 'full' | 'quick'
): void {
  trackCustomEvent('OnboardingStep', { step, stepName, path });
}

/**
 * Track "Surprise Me" button click
 */
export function trackSurpriseMe(): void {
  trackCustomEvent('SurpriseMe', {});
}

/**
 * Track companion creation
 */
export function trackCompanionCreated(companionId: string): void {
  trackCustomEvent('CompanionCreated', { companionId });
}

/**
 * Track chat session start
 */
export function trackChatStarted(sessionId: string, companionId: string): void {
  trackCustomEvent('ChatStarted', { sessionId, companionId });
}

/**
 * Track first message in a chat session
 */
export function trackFirstMessage(sessionId: string): void {
  trackCustomEvent('FirstMessage', { sessionId });
}

/**
 * Track gift sent to companion
 */
export function trackGiftSent(
  giftType: string,
  tokenCost: number,
  companionId: string
): void {
  trackCustomEvent('GiftSent', { giftType, tokenCost, companionId });
}

/**
 * Track gift template purchased
 */
export function trackGiftPurchased(templateId: string, tokenCost: number): void {
  trackCustomEvent('GiftPurchased', { templateId, tokenCost });
}

// Storage keys for deduplication and cross-page tracking
const STORAGE_KEYS = {
  PENDING_PURCHASE: 'meta_pixel_pending_purchase',
  CHAT_STARTED_PREFIX: 'meta_pixel_chat_started_',
  FIRST_MESSAGE_PREFIX: 'meta_pixel_first_message_',
} as const;

/**
 * Store pending purchase info before redirect to payment
 */
export function storePendingPurchase(
  bundleId: string,
  bundleName: string,
  priceInCents: number
): void {
  if (typeof window === 'undefined') return;

  sessionStorage.setItem(
    STORAGE_KEYS.PENDING_PURCHASE,
    JSON.stringify({ bundleId, bundleName, priceInCents, timestamp: Date.now() })
  );
}

/**
 * Check for and fire pending purchase event (call on success redirect)
 */
export function checkAndFirePendingPurchase(): boolean {
  if (typeof window === 'undefined') return false;

  const stored = sessionStorage.getItem(STORAGE_KEYS.PENDING_PURCHASE);
  if (!stored) return false;

  try {
    const { bundleId, bundleName, priceInCents, timestamp } = JSON.parse(stored);

    // Only fire if stored within last 30 minutes
    if (Date.now() - timestamp > 30 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING_PURCHASE);
      return false;
    }

    trackPurchase(bundleId, bundleName, priceInCents);
    sessionStorage.removeItem(STORAGE_KEYS.PENDING_PURCHASE);
    return true;
  } catch {
    sessionStorage.removeItem(STORAGE_KEYS.PENDING_PURCHASE);
    return false;
  }
}

/**
 * Check if chat started event was already fired for this session
 */
export function hasChatStartedFired(sessionId: string): boolean {
  if (typeof window === 'undefined') return true;
  return sessionStorage.getItem(STORAGE_KEYS.CHAT_STARTED_PREFIX + sessionId) === 'true';
}

/**
 * Mark chat started event as fired for this session
 */
export function markChatStartedFired(sessionId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEYS.CHAT_STARTED_PREFIX + sessionId, 'true');
}

/**
 * Check if first message event was already fired for this session
 */
export function hasFirstMessageFired(sessionId: string): boolean {
  if (typeof window === 'undefined') return true;
  return sessionStorage.getItem(STORAGE_KEYS.FIRST_MESSAGE_PREFIX + sessionId) === 'true';
}

/**
 * Mark first message event as fired for this session
 */
export function markFirstMessageFired(sessionId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEYS.FIRST_MESSAGE_PREFIX + sessionId, 'true');
}
