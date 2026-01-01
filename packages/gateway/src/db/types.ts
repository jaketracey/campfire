/**
 * Database type definitions for Project Campfire
 * These types mirror the PostgreSQL schema
 */

// ============================================================================
// Common Types
// ============================================================================

export type UUID = string;
export type Timestamp = Date;
export type JSONValue = string | number | boolean | null | undefined | JSONObject | JSONArray;
export type JSONObject = Record<string, unknown>;
export type JSONArray = JSONValue[];

// ============================================================================
// Event Store Types
// ============================================================================

export interface Event {
  event_id: UUID;
  timestamp: Timestamp;
  user_id: UUID | null;
  session_id: UUID | null;
  turn_id: UUID | null;
  trace_id: UUID | null;
  type: string;
  payload: JSONObject;
  version: number;
  causation_id: UUID | null;
  correlation_id: UUID | null;
  cost: number | null;
  created_at: Timestamp;
}

export interface EventInsert {
  event_id: UUID;
  timestamp?: Timestamp;
  user_id?: UUID | null;
  session_id?: UUID | null;
  turn_id?: UUID | null;
  trace_id?: UUID | null;
  type: string;
  payload: JSONObject;
  version?: number;
  causation_id?: UUID | null;
  correlation_id?: UUID | null;
  cost?: number | null;
}

// ============================================================================
// User Types
// ============================================================================

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface User {
  id: UUID;
  email: string;
  password_hash: string;
  email_verified: boolean;
  email_verified_at: Timestamp | null;
  status: UserStatus;
  role: UserRole;
  last_login_at: Timestamp | null;
  login_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserInsert {
  id?: UUID;
  email: string;
  password_hash: string;
  email_verified?: boolean;
  status?: UserStatus;
  role?: UserRole;
}

export interface UserProfile {
  id: UUID;
  user_id: UUID;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  preferences: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserProfileInsert {
  user_id: UUID;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  timezone?: string | null;
  locale?: string | null;
  preferences?: JSONObject;
}

export interface UserMFA {
  id: UUID;
  user_id: UUID;
  method: MFAMethod;
  secret_encrypted: string;
  enabled: boolean;
  verified_at: Timestamp | null;
  backup_codes_hash: string[] | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type MFAMethod = 'totp' | 'sms' | 'email';

export interface UserMFAInsert {
  user_id: UUID;
  method: MFAMethod;
  secret_encrypted: string;
  enabled?: boolean;
  backup_codes_hash?: string[] | null;
}

// ============================================================================
// Referral Types
// ============================================================================

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface InviteCode {
  id: UUID;
  user_id: UUID;
  code: string;
  uses_count: number;
  max_uses: number | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  expires_at: Timestamp | null;
}

export interface InviteCodeInsert {
  user_id: UUID;
  code?: string;
  max_uses?: number | null;
  expires_at?: Timestamp | null;
}

export interface UserReferral {
  id: UUID;
  referred_user_id: UUID;
  referrer_user_id: UUID;
  invite_code_id: UUID;
  code_used: string;
  converted_at: Timestamp | null;
  created_at: Timestamp;
}

export interface UserReferralInsert {
  referred_user_id: UUID;
  referrer_user_id: UUID;
  invite_code_id: UUID;
  code_used: string;
}

export interface PendingInvite {
  id: UUID;
  email: string;
  email_normalized: string;
  token: string;
  invited_by_user_id: UUID | null;
  status: InviteStatus;
  message: string | null;
  created_at: Timestamp;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  accepted_by_user_id: UUID | null;
}

export interface PendingInviteInsert {
  email: string;
  token: string;
  invited_by_user_id?: UUID | null;
  message?: string | null;
  expires_at?: Timestamp;
}

// ============================================================================
// Companion Types
// ============================================================================

export interface Companion {
  id: UUID;
  user_id: UUID;
  name: string;
  spec: CompanionSpec;
  spec_version: number;
  status: CompanionStatus;
  is_public: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type CompanionStatus = 'draft' | 'active' | 'archived';

/**
 * Physical appearance settings for companion image generation.
 * These map directly to pre-generated variation images.
 */
export interface CompanionAppearance {
  ethnicity: 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
  bodyType: 'slim' | 'athletic' | 'curvy' | 'plus-size';
  hairColor: 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
  breastSize?: number; // 0-100
}

export interface CompanionSpec {
  identity: {
    name: string;
    pronouns: string;
    address_style: string;
  };
  personality: {
    archetype: string;
    secondary_archetype?: string;
    traits: Record<string, number>;
  };
  voice: {
    provider: string;
    voice_id: string;
    settings?: Record<string, unknown>;
  };
  visual_style: {
    style_type: string;
    appearance?: CompanionAppearance;
    palette?: string[];
    constraints?: string[];
    reference_assets?: string[];
  };
  boundaries: {
    relationship_pacing: string;
    topics_avoid?: string[];
    safe_topics?: string[];
    content_rating: string;
    emotional_depth?: 'surface' | 'moderate' | 'deep';
  };
  memory_consent: {
    allow_long_term: boolean;
    allow_kg_extraction: boolean;
    retention_days?: number;
  };
  tenets?: Array<{
    id: string;
    category: string;
    priority: 'core' | 'situational';
    rule: string;
    description?: string;
    isNegation: boolean;
    triggerContexts?: string[];
  }>;
}

export interface CompanionInsert {
  id?: UUID;
  user_id: UUID;
  name: string;
  spec: CompanionSpec;
  spec_version?: number;
  status?: CompanionStatus;
  is_public?: boolean;
}

export interface CompanionAvatar {
  id: UUID;
  companion_id: UUID;
  asset_url: string;
  asset_type: AvatarAssetType;
  is_active: boolean;
  is_identity_anchor: boolean;
  metadata: JSONObject;
  generation_params: JSONObject | null;
  source_event_id: UUID | null;
  created_at: Timestamp;
}

export type AvatarAssetType = 'identity_anchor' | 'stateful' | 'scene';

export interface CompanionAvatarInsert {
  companion_id: UUID;
  asset_url: string;
  asset_type: AvatarAssetType;
  is_active?: boolean;
  is_identity_anchor?: boolean;
  metadata?: JSONObject;
  generation_params?: JSONObject | null;
  source_event_id?: UUID | null;
}

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  status: SessionStatus;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type SessionStatus = 'active' | 'paused' | 'ended' | 'error';

export interface SessionInsert {
  id?: UUID;
  user_id: UUID;
  companion_id: UUID;
  status?: SessionStatus;
  metadata?: JSONObject;
}

export interface Turn {
  id: UUID;
  session_id: UUID;
  turn_number: number;
  user_message: string | null;
  user_message_type: MessageType;
  agent_message: string | null;
  agent_message_type: MessageType;
  started_at: Timestamp;
  completed_at: Timestamp | null;
  latency_ms: number | null;
  token_count_input: number | null;
  token_count_output: number | null;
  cost_usd: number | null;
  metadata: JSONObject;
  created_at: Timestamp;
  /** Which companion sent the agent_message (for group chat) */
  companion_id: UUID | null;
}

export type MessageType = 'text' | 'audio' | 'image' | 'multimodal';

export interface TurnInsert {
  id?: UUID;
  session_id: UUID;
  turn_number: number;
  user_message?: string | null;
  user_message_type?: MessageType;
  agent_message?: string | null;
  agent_message_type?: MessageType;
  latency_ms?: number | null;
  token_count_input?: number | null;
  token_count_output?: number | null;
  cost_usd?: number | null;
  metadata?: JSONObject;
  companion_id?: UUID | null;
}

// ============================================================================
// Companion Friends Types (Group Chat)
// ============================================================================

export interface CompanionFriend {
  id: UUID;
  companion_id: UUID;
  friend_companion_id: UUID;
  relationship_type: string | null;
  how_they_met: string | null;
  nickname: string | null;
  familiarity_level: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CompanionFriendInsert {
  companion_id: UUID;
  friend_companion_id: UUID;
  relationship_type?: string | null;
  how_they_met?: string | null;
  nickname?: string | null;
  familiarity_level?: number;
}

// ============================================================================
// Session Participants Types (Group Chat)
// ============================================================================

export type SessionParticipantRole = 'primary' | 'invited';
export type SessionParticipantStatus = 'active' | 'left';

export interface SessionParticipant {
  id: UUID;
  session_id: UUID;
  companion_id: UUID;
  role: SessionParticipantRole;
  status: SessionParticipantStatus;
  invited_by_companion_id: UUID | null;
  joined_at: Timestamp;
  left_at: Timestamp | null;
  message_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SessionParticipantInsert {
  session_id: UUID;
  companion_id: UUID;
  role?: SessionParticipantRole;
  status?: SessionParticipantStatus;
  invited_by_companion_id?: UUID | null;
}

/**
 * Session participant with companion details for API responses
 */
export interface SessionParticipantWithCompanion extends SessionParticipant {
  companion_name: string;
  companion_avatar_url: string | null;
}

// ============================================================================
// Memory Types
// ============================================================================

export interface Memory {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  content: string;
  content_type: MemoryContentType;
  embedding: number[] | null; // pgvector stores as float array
  importance: number;
  source_event_id: UUID | null;
  source_turn_id: UUID | null;
  metadata: JSONObject;
  expires_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type MemoryContentType = 'fact' | 'preference' | 'event' | 'summary' | 'reflection';

export interface MemoryInsert {
  id?: UUID;
  user_id: UUID;
  companion_id: UUID;
  content: string;
  content_type?: MemoryContentType;
  embedding?: number[] | null;
  importance?: number;
  source_event_id?: UUID | null;
  source_turn_id?: UUID | null;
  metadata?: JSONObject;
  expires_at?: Timestamp | null;
}

// ============================================================================
// Knowledge Graph Types
// ============================================================================

export interface KGEntity {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  name: string;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
  metadata: JSONObject;
  source_event_id: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface KGEntityInsert {
  id?: UUID;
  user_id: UUID;
  companion_id: UUID;
  name: string;
  canonical_name?: string;
  entity_type: string;
  aliases?: string[];
  metadata?: JSONObject;
  source_event_id?: UUID | null;
}

export interface KGEdge {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  source_entity_id: UUID;
  target_entity_id: UUID;
  relation_type: string;
  confidence: number;
  status: KGEdgeStatus;
  source_event_id: UUID | null;
  first_seen: Timestamp;
  last_seen: Timestamp;
  last_confirmed: Timestamp | null;
  mention_count: number;
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type KGEdgeStatus = 'proposed' | 'active' | 'deprecated' | 'deleted';

export interface KGEdgeInsert {
  id?: UUID;
  user_id: UUID;
  companion_id: UUID;
  source_entity_id: UUID;
  target_entity_id: UUID;
  relation_type: string;
  confidence?: number;
  status?: KGEdgeStatus;
  source_event_id?: UUID | null;
  metadata?: JSONObject;
}

// ============================================================================
// Billing Types
// ============================================================================

export interface Subscription {
  id: UUID;
  user_id: UUID;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  current_period_start: Timestamp;
  current_period_end: Timestamp;
  cancel_at_period_end: boolean;
  canceled_at: Timestamp | null;
  trial_start: Timestamp | null;
  trial_end: Timestamp | null;
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired';

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';

export interface SubscriptionInsert {
  user_id: UUID;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  current_period_start: Timestamp;
  current_period_end: Timestamp;
  cancel_at_period_end?: boolean;
  trial_start?: Timestamp | null;
  trial_end?: Timestamp | null;
  metadata?: JSONObject;
}

export interface BillingEvent {
  id: UUID;
  user_id: UUID | null;
  stripe_event_id: string;
  stripe_event_type: string;
  payload: JSONObject;
  processed: boolean;
  processed_at: Timestamp | null;
  error: string | null;
  created_at: Timestamp;
}

export interface BillingEventInsert {
  user_id?: UUID | null;
  stripe_event_id: string;
  stripe_event_type: string;
  payload: JSONObject;
  processed?: boolean;
  error?: string | null;
}

// ============================================================================
// Vault Types
// ============================================================================

export interface VaultFile {
  id: UUID;
  user_id: UUID;
  companion_id: UUID | null;
  path: string;
  file_type: VaultFileType;
  content_hash: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  source_event_ids: UUID[];
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type VaultFileType =
  | 'conversation'
  | 'daily'
  | 'memory'
  | 'entity'
  | 'person'
  | 'companion'
  | 'index';

export interface VaultFileInsert {
  user_id: UUID;
  companion_id?: UUID | null;
  path: string;
  file_type: VaultFileType;
  content_hash: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  source_event_ids?: UUID[];
  metadata?: JSONObject;
}

// ============================================================================
// Token & Gift Types
// ============================================================================

export type TokenTransactionType =
  | 'purchase'
  | 'subscription_bonus'
  | 'gift_spent'
  | 'refund'
  | 'admin_grant';

export type GiftStatus = 'generating' | 'ready' | 'given' | 'failed';

export interface TokenBalance {
  id: UUID;
  user_id: UUID;
  balance: number;
  lifetime_purchased: number;
  lifetime_bonus: number;
  lifetime_spent: number;
  current_period_bonus: number;
  bonus_granted_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TokenBalanceInsert {
  user_id: UUID;
  balance?: number;
}

export interface TokenTransaction {
  id: UUID;
  user_id: UUID;
  transaction_type: TokenTransactionType;
  amount: number;
  balance_after: number;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  gift_id: UUID | null;
  subscription_id: UUID | null;
  description: string | null;
  metadata: JSONObject;
  idempotency_key: string | null;
  created_at: Timestamp;
}

export interface TokenTransactionInsert {
  user_id: UUID;
  transaction_type: TokenTransactionType;
  amount: number;
  balance_after: number;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  gift_id?: UUID | null;
  subscription_id?: UUID | null;
  description?: string | null;
  metadata?: JSONObject;
  idempotency_key?: string | null;
}

export interface TokenBundle {
  id: UUID;
  name: string;
  description: string | null;
  tokens: number;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  is_active: boolean;
  display_order: number;
  bonus_tokens: number;
  bonus_expires_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TokenBundleInsert {
  name: string;
  description?: string | null;
  tokens: number;
  price_cents: number;
  currency?: string;
  stripe_price_id?: string | null;
  stripe_product_id?: string | null;
  is_active?: boolean;
  display_order?: number;
  bonus_tokens?: number;
  bonus_expires_at?: Timestamp | null;
}

export interface Gift {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  name: string;
  description: string | null;
  visual_prompt: string | null;
  emotional_meaning: string | null;
  image_url: string | null;
  s3_bucket: string | null;
  s3_key: string | null;
  token_cost: number;
  status: GiftStatus;
  generation_params: JSONObject | null;
  generation_error: string | null;
  source_event_id: UUID | null;
  source_turn_id: UUID | null;
  given_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GiftInsert {
  id?: UUID;
  user_id: UUID;
  companion_id: UUID;
  name: string;
  description?: string | null | undefined;
  visual_prompt?: string | null | undefined;
  emotional_meaning?: string | null | undefined;
  token_cost: number;
  status?: GiftStatus;
  generation_params?: JSONObject | null | undefined;
  source_event_id?: UUID | null | undefined;
  source_turn_id?: UUID | null | undefined;
}

export interface GiftMemory {
  id: UUID;
  gift_id: UUID;
  user_id: UUID;
  companion_id: UUID;
  memory_content: string;
  embedding: number[] | null;
  times_recalled: number;
  last_recalled_at: Timestamp | null;
  eligible_for_recall: boolean;
  recall_cooldown_until: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GiftMemoryInsert {
  gift_id: UUID;
  user_id: UUID;
  companion_id: UUID;
  memory_content: string;
  embedding?: number[] | null;
  eligible_for_recall?: boolean;
  recall_cooldown_until?: Timestamp | null;
}

// ============================================================================
// Migration Types
// ============================================================================

export interface Migration {
  id: number;
  name: string;
  executed_at: Timestamp;
  checksum: string;
}
