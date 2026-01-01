import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';
import { SubscriptionTierSchema } from './billing.js';

/**
 * Gift type enumeration
 */
export const GiftTypeSchema = z.enum(['virtual_object', 'poem', 'song', 'memory_collage', 'custom']);
export type GiftType = z.infer<typeof GiftTypeSchema>;

/**
 * Acknowledgment type enumeration
 */
export const AcknowledgmentTypeSchema = z.enum(['joy', 'surprise', 'touched', 'grateful', 'loving']);
export type AcknowledgmentType = z.infer<typeof AcknowledgmentTypeSchema>;

/**
 * Recall trigger enumeration
 */
export const RecallTriggerSchema = z.enum(['random', 'context_match', 'anniversary', 'emotional_resonance']);
export type RecallTrigger = z.infer<typeof RecallTriggerSchema>;

// ============================================================================
// gift.generated
// ============================================================================

export const GiftGeneratedPayloadSchema = z.object({
  /** Unique gift identifier */
  giftId: z.string().uuid(),
  /** User who generated the gift */
  userId: z.string().uuid(),
  /** Companion associated with the gift */
  companionId: z.string().uuid(),
  /** Type of gift generated */
  giftType: GiftTypeSchema,
  /** Gift title */
  title: z.string().min(1),
  /** Gift description */
  description: z.string().min(1),
  /** Visual generation prompt (if applicable) */
  visualPrompt: z.string().optional(),
  /** URL to generated visual (if applicable) */
  visualUrl: z.string().url().optional(),
  /** Emotional meaning of the gift */
  emotionalMeaning: z.string().min(1),
  /** Token cost for generating this gift */
  tokenCost: z.number().int().nonnegative(),
});

export type GiftGeneratedPayload = z.infer<typeof GiftGeneratedPayloadSchema>;

export const GiftGeneratedEventSchema = createEventSchema(
  EventTypes.GIFT_GENERATED,
  GiftGeneratedPayloadSchema
);

export type GiftGeneratedEvent = TypedEvent<
  typeof EventTypes.GIFT_GENERATED,
  GiftGeneratedPayload
>;

// ============================================================================
// gift.received
// ============================================================================

export const GiftReceivedPayloadSchema = z.object({
  /** Unique gift identifier */
  giftId: z.string().uuid(),
  /** User who received or gave the gift */
  userId: z.string().uuid(),
  /** Companion associated with the gift */
  companionId: z.string().uuid(),
  /** Whether the gift is from the user (true) or from the companion (false) */
  fromUser: z.boolean(),
  /** Description of the gift */
  giftDescription: z.string().min(1),
  /** Optional message from the giver */
  userMessage: z.string().optional(),
});

export type GiftReceivedPayload = z.infer<typeof GiftReceivedPayloadSchema>;

export const GiftReceivedEventSchema = createEventSchema(
  EventTypes.GIFT_RECEIVED,
  GiftReceivedPayloadSchema
);

export type GiftReceivedEvent = TypedEvent<
  typeof EventTypes.GIFT_RECEIVED,
  GiftReceivedPayload
>;

// ============================================================================
// gift.acknowledged
// ============================================================================

export const GiftAcknowledgedPayloadSchema = z.object({
  /** Unique gift identifier */
  giftId: z.string().uuid(),
  /** Companion acknowledging the gift */
  companionId: z.string().uuid(),
  /** Type of acknowledgment emotion */
  acknowledgmentType: AcknowledgmentTypeSchema,
  /** Content of the acknowledgment response */
  responseContent: z.string().min(1),
  /** Intensity of the emotion (0-1 scale) */
  emotionIntensity: z.number().min(0).max(1),
});

export type GiftAcknowledgedPayload = z.infer<typeof GiftAcknowledgedPayloadSchema>;

export const GiftAcknowledgedEventSchema = createEventSchema(
  EventTypes.GIFT_ACKNOWLEDGED,
  GiftAcknowledgedPayloadSchema
);

export type GiftAcknowledgedEvent = TypedEvent<
  typeof EventTypes.GIFT_ACKNOWLEDGED,
  GiftAcknowledgedPayload
>;

// ============================================================================
// gift.memory.recalled
// ============================================================================

export const GiftMemoryRecalledPayloadSchema = z.object({
  /** Unique gift identifier being recalled */
  giftId: z.string().uuid(),
  /** Companion recalling the memory */
  companionId: z.string().uuid(),
  /** Session where the recall occurred */
  sessionId: z.string().uuid(),
  /** Turn within session (optional) */
  turnId: z.string().uuid().optional(),
  /** What triggered the recall */
  recallTrigger: RecallTriggerSchema,
  /** Content of the recall */
  recallContent: z.string().min(1),
  /** ISO8601 timestamp of when the original gift was given */
  originalGiftDate: z.string().datetime({ offset: true }),
});

export type GiftMemoryRecalledPayload = z.infer<typeof GiftMemoryRecalledPayloadSchema>;

export const GiftMemoryRecalledEventSchema = createEventSchema(
  EventTypes.GIFT_MEMORY_RECALLED,
  GiftMemoryRecalledPayloadSchema
);

export type GiftMemoryRecalledEvent = TypedEvent<
  typeof EventTypes.GIFT_MEMORY_RECALLED,
  GiftMemoryRecalledPayload
>;

// ============================================================================
// tokens.purchased
// ============================================================================

export const TokensPurchasedPayloadSchema = z.object({
  /** User who purchased tokens */
  userId: z.string().uuid(),
  /** Bundle identifier purchased */
  bundleId: z.string().uuid(),
  /** Name of the bundle */
  bundleName: z.string().min(1),
  /** Number of tokens added from purchase */
  tokensAdded: z.number().int().positive(),
  /** Bonus tokens included */
  bonusTokens: z.number().int().nonnegative(),
  /** Price in cents */
  priceCents: z.number().int().nonnegative(),
  /** Stripe payment intent ID */
  stripePaymentIntentId: z.string().min(1),
  /** Stripe checkout session ID */
  stripeCheckoutSessionId: z.string().min(1),
  /** New token balance after purchase */
  newBalance: z.number().int().nonnegative(),
});

export type TokensPurchasedPayload = z.infer<typeof TokensPurchasedPayloadSchema>;

export const TokensPurchasedEventSchema = createEventSchema(
  EventTypes.TOKENS_PURCHASED,
  TokensPurchasedPayloadSchema
);

export type TokensPurchasedEvent = TypedEvent<
  typeof EventTypes.TOKENS_PURCHASED,
  TokensPurchasedPayload
>;

// ============================================================================
// tokens.bonus_granted
// ============================================================================

export const TokensBonusGrantedPayloadSchema = z.object({
  /** User receiving the bonus */
  userId: z.string().uuid(),
  /** Subscription ID associated with the bonus */
  subscriptionId: z.string().uuid(),
  /** Subscription plan tier */
  plan: SubscriptionTierSchema,
  /** Number of tokens added */
  tokensAdded: z.number().int().positive(),
  /** New token balance after bonus */
  newBalance: z.number().int().nonnegative(),
  /** ISO8601 timestamp of period start */
  periodStart: z.string().datetime({ offset: true }),
});

export type TokensBonusGrantedPayload = z.infer<typeof TokensBonusGrantedPayloadSchema>;

export const TokensBonusGrantedEventSchema = createEventSchema(
  EventTypes.TOKENS_BONUS_GRANTED,
  TokensBonusGrantedPayloadSchema
);

export type TokensBonusGrantedEvent = TypedEvent<
  typeof EventTypes.TOKENS_BONUS_GRANTED,
  TokensBonusGrantedPayload
>;

// ============================================================================
// tokens.spent
// ============================================================================

export const TokensSpentPayloadSchema = z.object({
  /** User who spent tokens */
  userId: z.string().uuid(),
  /** Gift ID that tokens were spent on */
  giftId: z.string().uuid(),
  /** Number of tokens spent */
  tokensSpent: z.number().int().positive(),
  /** New token balance after spending */
  newBalance: z.number().int().nonnegative(),
  /** Optional description of what tokens were spent on */
  description: z.string().optional(),
});

export type TokensSpentPayload = z.infer<typeof TokensSpentPayloadSchema>;

export const TokensSpentEventSchema = createEventSchema(
  EventTypes.TOKENS_SPENT,
  TokensSpentPayloadSchema
);

export type TokensSpentEvent = TypedEvent<
  typeof EventTypes.TOKENS_SPENT,
  TokensSpentPayload
>;
