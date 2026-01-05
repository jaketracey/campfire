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

// ============================================================================
// Companion Appearance Types
// ============================================================================

export type CompanionGender = 'male' | 'female';
export type FemaleBodyType = 'slim' | 'athletic' | 'curvy' | 'plus-size';
export type MaleBodyType = 'slim' | 'athletic' | 'muscular' | 'dad-bod';
export type AppearanceBodyType = FemaleBodyType | MaleBodyType;
export type AppearanceEthnicity = 'east-asian' | 'south-asian' | 'black' | 'caucasian' | 'latina' | 'middle-eastern' | 'mixed';
export type AppearanceHairColor = 'black' | 'brown' | 'blonde' | 'red' | 'fantasy';
export type SizeCategory = 'S' | 'M' | 'L';

/**
 * Base appearance fields shared by both genders
 */
interface BaseCompanionAppearance {
  ethnicity: AppearanceEthnicity;
  hairColor: AppearanceHairColor;
}

/**
 * Female-specific appearance settings
 */
export interface FemaleAppearance extends BaseCompanionAppearance {
  gender: 'female';
  bodyType: FemaleBodyType;
  breastSize: SizeCategory;
}

/**
 * Male-specific appearance settings
 */
export interface MaleAppearance extends BaseCompanionAppearance {
  gender: 'male';
  bodyType: MaleBodyType;
  build: SizeCategory;
}

/**
 * Physical appearance settings for companion image generation.
 * These map directly to pre-generated variation images.
 * Discriminated union based on gender.
 */
export type CompanionAppearance = FemaleAppearance | MaleAppearance;

// Type guards
export function isFemaleAppearance(appearance: CompanionAppearance): appearance is FemaleAppearance {
  return appearance.gender === 'female';
}

export function isMaleAppearance(appearance: CompanionAppearance): appearance is MaleAppearance {
  return appearance.gender === 'male';
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
// Companion Image Types (Gallery)
// ============================================================================

export interface CompanionImage {
  id: UUID;
  user_id: string;
  session_id: string;
  companion_id: string | null;
  s3_key: string;
  s3_url: string;
  width: number;
  height: number;
  format: string;
  size_bytes: number | null;
  emotional_state: string;
  style: string;
  prompt: string | null;
  cache_key: string;
  provider: string;
  latency_ms: number | null;
  renditions: JSONObject | null;
  created_at: Timestamp;
}

export interface CompanionImageInsert {
  user_id: string;
  session_id: string;
  companion_id?: string | null;
  s3_key: string;
  s3_url: string;
  width: number;
  height: number;
  format?: string;
  size_bytes?: number | null;
  emotional_state: string;
  style: string;
  prompt?: string | null;
  cache_key: string;
  provider?: string;
  latency_ms?: number | null;
  renditions?: JSONObject | null;
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
  flowguard_customer_id: string;
  flowguard_subscription_id: string;
  flowguard_price_id: string | null;
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
  flowguard_customer_id: string;
  flowguard_subscription_id: string;
  flowguard_price_id?: string | null;
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
  flowguard_event_id: string;
  flowguard_event_type: string;
  payload: JSONObject;
  processed: boolean;
  processed_at: Timestamp | null;
  error: string | null;
  created_at: Timestamp;
}

export interface BillingEventInsert {
  user_id?: UUID | null;
  flowguard_event_id: string;
  flowguard_event_type: string;
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
  | 'voice_call'
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
  flowguard_transaction_id: string | null;
  flowguard_session_id: string | null;
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
  flowguard_transaction_id?: string | null;
  flowguard_session_id?: string | null;
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
  flowguard_price_id: string | null;
  flowguard_product_id: string | null;
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
  flowguard_price_id?: string | null;
  flowguard_product_id?: string | null;
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
// Gift Template Types (Global Gift Library)
// ============================================================================

export type GiftTemplateStatus = 'active' | 'hidden' | 'archived';

export type GiftTemplateCategory =
  | 'romantic'
  | 'friendship'
  | 'celebration'
  | 'comfort'
  | 'gratitude'
  | 'playful'
  | 'thoughtful'
  | 'mystical'
  | 'nature'
  | 'artistic'
  | 'other';

export interface GiftTemplate {
  id: UUID;
  name: string;
  description: string | null;
  visual_prompt: string | null;
  emotional_meaning: string | null;
  image_url: string;
  s3_bucket: string | null;
  s3_key: string | null;
  category: GiftTemplateCategory;
  token_cost: number;
  tier: string;
  status: GiftTemplateStatus;
  total_sends: number;
  sends_last_7_days: number;
  sends_last_30_days: number;
  last_sent_at: Timestamp | null;
  source_gift_id: UUID | null;
  content_hash: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GiftTemplateInsert {
  name: string;
  description?: string | null;
  visual_prompt?: string | null;
  emotional_meaning?: string | null;
  image_url: string;
  s3_bucket?: string | null;
  s3_key?: string | null;
  category?: GiftTemplateCategory;
  token_cost: number;
  tier?: string;
  source_gift_id?: UUID | null;
  content_hash: string;
}

// ============================================================================
// Support Ticket Types
// ============================================================================

export type SupportTicketCategory = 'bug' | 'feature_request' | 'account' | 'billing' | 'other';
export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportTicket {
  id: UUID;
  user_id: UUID;
  category: SupportTicketCategory;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  resolved_at: Timestamp | null;
  resolved_by_user_id: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SupportTicketInsert {
  id?: UUID;
  user_id: UUID;
  category: SupportTicketCategory;
  subject: string;
  message: string;
  status?: SupportTicketStatus;
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

// ============================================================================
// Provider Settings Types
// ============================================================================

export type UseCaseType =
  | 'chat_simple'
  | 'chat_complex'
  | 'memory_extraction'
  | 'summarization'
  | 'context_compression'
  | 'safety_check'
  | 'content_moderation'
  | 'gift_generation'
  | 'image_generation'
  | 'image_anchor'
  | 'image_variation'
  | 'gift_image';

export const USE_CASE_TYPES: UseCaseType[] = [
  'chat_simple',
  'chat_complex',
  'memory_extraction',
  'summarization',
  'context_compression',
  'safety_check',
  'content_moderation',
  'gift_generation',
  'image_generation',
  'image_anchor',
  'image_variation',
  'gift_image',
];

/** Text-based use cases for LLM routing */
export const TEXT_USE_CASE_TYPES: UseCaseType[] = [
  'chat_simple',
  'chat_complex',
  'memory_extraction',
  'summarization',
  'context_compression',
  'safety_check',
  'content_moderation',
  'gift_generation',
];

/** Image-based use cases for image model routing */
export const IMAGE_USE_CASE_TYPES: UseCaseType[] = [
  'image_generation',
  'image_anchor',
  'image_variation',
  'gift_image',
];

export const USE_CASE_LABELS: Record<UseCaseType, string> = {
  chat_simple: 'Simple Chat',
  chat_complex: 'Complex Chat',
  memory_extraction: 'Memory Extraction',
  summarization: 'Summarization',
  context_compression: 'Context Compression',
  safety_check: 'Safety Check',
  content_moderation: 'Content Moderation',
  gift_generation: 'Gift Generation',
  image_generation: 'Image Generation',
  image_anchor: 'Identity Anchor Image',
  image_variation: 'Image Variation',
  gift_image: 'Gift Image',
};

/** Provider category: text for LLMs, image for image generation */
export type ProviderCategory = 'text' | 'image';

/** Image model capabilities */
export type ImageModelCapability = 'ip_adapter' | 'inpainting' | 'controlnet' | 'nsfw';

/** Extended model config for image models */
export interface ImageModelMetadata {
  nsfw_capable?: boolean;
  supports_ip_adapter?: boolean;
  supports_inpainting?: boolean;
  supports_controlnet?: boolean;
  max_resolution?: [number, number];
  aspect_ratios?: string[];
  cost_per_image?: number;
  avg_generation_time_ms?: number;
}

export interface ProviderConfig {
  id: UUID;
  provider: string;
  display_name: string;
  is_enabled: boolean;
  api_key_encrypted: Buffer | null;
  api_base_url: string | null;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  max_concurrent_requests: number;
  priority: number;
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProviderConfigInsert {
  provider: string;
  display_name: string;
  is_enabled?: boolean;
  api_key?: string; // Plain text, will be encrypted before storage
  api_base_url?: string | null;
  rate_limit_rpm?: number | null;
  rate_limit_tpm?: number | null;
  max_concurrent_requests?: number;
  priority?: number;
  metadata?: JSONObject;
}

export interface ProviderConfigUpdate {
  display_name?: string;
  is_enabled?: boolean;
  api_key?: string; // Plain text, will be encrypted before storage
  api_base_url?: string | null;
  rate_limit_rpm?: number | null;
  rate_limit_tpm?: number | null;
  max_concurrent_requests?: number;
  priority?: number;
  metadata?: JSONObject;
}

export type ModelCapability = 'chat' | 'vision' | 'function_calling' | 'streaming' | 'json_mode';

export interface ModelConfig {
  id: UUID;
  provider_config_id: UUID;
  model_id: string;
  display_name: string;
  is_enabled: boolean;
  context_window: number | null;
  max_output_tokens: number | null;
  input_cost_per_million: number | null;
  output_cost_per_million: number | null;
  capabilities: ModelCapability[];
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ModelConfigInsert {
  provider_config_id: UUID;
  model_id: string;
  display_name: string;
  is_enabled?: boolean;
  context_window?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_million?: number | null;
  output_cost_per_million?: number | null;
  capabilities?: ModelCapability[];
  metadata?: JSONObject;
}

export interface ModelConfigUpdate {
  display_name?: string;
  is_enabled?: boolean;
  context_window?: number | null;
  max_output_tokens?: number | null;
  input_cost_per_million?: number | null;
  output_cost_per_million?: number | null;
  capabilities?: ModelCapability[];
  metadata?: JSONObject;
}

export interface RoutingRule {
  id: UUID;
  use_case: UseCaseType;
  tier: number;
  model_config_id: UUID;
  weight: number;
  is_enabled: boolean;
  max_retries: number;
  timeout_ms: number;
  metadata: JSONObject;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RoutingRuleInsert {
  use_case: UseCaseType;
  tier?: number;
  model_config_id: UUID;
  weight?: number;
  is_enabled?: boolean;
  max_retries?: number;
  timeout_ms?: number;
  metadata?: JSONObject;
}

export interface RoutingRuleUpdate {
  tier?: number;
  weight?: number;
  is_enabled?: boolean;
  max_retries?: number;
  timeout_ms?: number;
  metadata?: JSONObject;
}

export interface CompanionRoutingOverride {
  id: UUID;
  companion_id: UUID;
  use_case: UseCaseType;
  tier: number;
  model_config_id: UUID;
  weight: number;
  is_enabled: boolean;
  max_retries: number | null;
  timeout_ms: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CompanionRoutingOverrideInsert {
  companion_id: UUID;
  use_case: UseCaseType;
  tier?: number;
  model_config_id: UUID;
  weight?: number;
  is_enabled?: boolean;
  max_retries?: number | null;
  timeout_ms?: number | null;
}

export interface CompanionRoutingOverrideUpdate {
  tier?: number;
  weight?: number;
  is_enabled?: boolean;
  max_retries?: number | null;
  timeout_ms?: number | null;
}

// Joined types for API responses
export interface ProviderConfigWithHealth extends Omit<ProviderConfig, 'api_key_encrypted'> {
  has_api_key: boolean;
  model_count: number;
  health: {
    is_available: boolean;
    last_check_at: Timestamp | null;
    avg_latency_ms: number | null;
    success_rate: number | null;
    error_count: number;
  } | null;
}

export interface ProviderConfigWithModels extends Omit<ProviderConfig, 'api_key_encrypted'> {
  has_api_key: boolean;
  models: ModelConfig[];
}

export interface ModelConfigWithProvider extends ModelConfig {
  provider: string;
  provider_display_name: string;
  provider_is_enabled: boolean;
}

export interface RoutingRuleWithModel extends RoutingRule {
  model: ModelConfigWithProvider;
}

export interface EffectiveRoutingEntry {
  tier: number;
  model_config_id: UUID;
  model_id: string;
  provider: string;
  weight: number;
  max_retries: number;
  timeout_ms: number;
  is_override: boolean;
}

export interface EffectiveRoutingConfig {
  companion_id: UUID | null;
  use_case: UseCaseType;
  entries: EffectiveRoutingEntry[];
  has_overrides: boolean;
}

// ============================================================================
// Affiliate Types
// ============================================================================

export type AffiliateStatus = 'active' | 'suspended' | 'inactive';
export type ConversionStatus = 'pending' | 'approved' | 'paid' | 'rejected';
export type PlanTier = 'standard' | 'premium';

/**
 * Payout information for affiliates
 */
export interface PayoutInfo {
  type: 'paypal' | 'bank' | 'other';
  paypalEmail?: string;
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string;
  notes?: string;
}

export interface Affiliate {
  id: UUID;
  name: string;
  email: string;
  email_normalized: string;
  code: string;
  password_hash: string;
  commission_standard: number; // cents
  commission_premium: number;  // cents
  status: AffiliateStatus;
  payout_info: PayoutInfo;
  notes: string | null;
  total_clicks: number;
  total_conversions: number;
  total_earned: number; // cents
  total_paid: number;   // cents
  last_login_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AffiliateInsert {
  id?: UUID;
  name: string;
  email: string;
  code?: string; // Auto-generated if not provided
  password_hash: string;
  commission_standard?: number;
  commission_premium?: number;
  status?: AffiliateStatus;
  payout_info?: PayoutInfo;
  notes?: string | null;
}

export interface AffiliateUpdate {
  name?: string;
  email?: string;
  code?: string;
  password_hash?: string;
  commission_standard?: number;
  commission_premium?: number;
  status?: AffiliateStatus;
  payout_info?: PayoutInfo;
  notes?: string | null;
}

export interface AffiliateClick {
  id: UUID;
  affiliate_id: UUID;
  ip_hash: string | null;
  user_agent: string | null;
  referrer_url: string | null;
  landing_page: string | null;
  created_at: Timestamp;
}

export interface AffiliateClickInsert {
  id?: UUID;
  affiliate_id: UUID;
  ip_hash?: string | null;
  user_agent?: string | null;
  referrer_url?: string | null;
  landing_page?: string | null;
}

export interface AffiliateConversion {
  id: UUID;
  affiliate_id: UUID;
  user_id: UUID | null;
  click_id: UUID | null;
  plan_tier: PlanTier;
  commission_amount: number; // cents, locked at time of conversion
  status: ConversionStatus;
  rejection_reason: string | null;
  paid_at: Timestamp | null;
  flowguard_transaction_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AffiliateConversionInsert {
  id?: UUID;
  affiliate_id: UUID;
  user_id?: UUID | null;
  click_id?: UUID | null;
  plan_tier: PlanTier;
  commission_amount: number;
  status?: ConversionStatus;
  flowguard_transaction_id?: string | null;
}

export interface AffiliateConversionUpdate {
  status?: ConversionStatus;
  rejection_reason?: string | null;
  paid_at?: Timestamp | null;
}

export interface AffiliateSession {
  id: UUID;
  affiliate_id: UUID;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
}

export interface AffiliateSessionInsert {
  id?: UUID;
  affiliate_id: UUID;
  token_hash: string;
  ip_address?: string | null;
  user_agent?: string | null;
  expires_at: Timestamp;
}

/**
 * Affiliate with computed stats for list views
 */
export interface AffiliateWithStats extends Affiliate {
  pending_earnings: number; // sum of pending conversions
  pending_conversions: number;
}

/**
 * Conversion with affiliate and user details for admin views
 */
export interface AffiliateConversionWithDetails extends AffiliateConversion {
  affiliate_name: string;
  affiliate_code: string;
  user_email: string | null;
}

/**
 * Summary of pending payouts grouped by affiliate
 */
export interface PendingPayoutSummary {
  affiliate_id: UUID;
  affiliate_name: string;
  affiliate_code: string;
  affiliate_email: string;
  payout_info: PayoutInfo;
  pending_amount: number; // cents
  pending_count: number;
  conversions: AffiliateConversion[];
}

// ============================================================================
// Video Request Types
// ============================================================================

export type VideoRequestStatus = 'pending' | 'generating' | 'encoding' | 'ready' | 'failed';

export interface VideoRequest {
  id: UUID;
  user_id: UUID;
  companion_id: UUID;
  session_id: UUID | null;
  prompt: string;
  generated_prompt: string | null;
  duration_seconds: number;
  width: number;
  height: number;
  fps: number;
  s3_bucket: string | null;
  s3_key: string | null;
  video_url: string | null;
  thumbnail_s3_key: string | null;
  thumbnail_url: string | null;
  file_size_bytes: number | null;
  status: VideoRequestStatus;
  token_cost: number;
  generation_params: JSONObject | null;
  generation_error: string | null;
  processing_time_ms: number | null;
  source_turn_id: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface VideoRequestInsert {
  id?: UUID;
  user_id: UUID;
  companion_id: UUID;
  session_id?: UUID | null;
  prompt: string;
  generated_prompt?: string | null;
  duration_seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  token_cost?: number;
  source_turn_id?: UUID | null;
}

export interface VideoRequestUpdate {
  status?: VideoRequestStatus;
  generated_prompt?: string | null;
  s3_bucket?: string | null;
  s3_key?: string | null;
  video_url?: string | null;
  thumbnail_s3_key?: string | null;
  thumbnail_url?: string | null;
  file_size_bytes?: number | null;
  generation_params?: JSONObject | null;
  generation_error?: string | null;
  processing_time_ms?: number | null;
  completed_at?: Timestamp | null;
}

/**
 * Video request with companion details for API responses
 */
export interface VideoRequestWithCompanion extends VideoRequest {
  companion_name: string;
  companion_avatar_url: string | null;
}

// ============================================================================
// Engagement Tracking Types
// ============================================================================

export type EngagementLevel = 'low' | 'medium' | 'high';

export interface EngagementSignal {
  id: UUID;
  anonymous_usage_id: UUID;
  session_id: UUID | null;
  message_number: number;

  // Emotional depth signals (0-100)
  sentiment_score: number;
  personal_pronoun_density: number;
  vulnerability_score: number;
  emotional_language_score: number;

  // Investment signals (0-100)
  message_length_score: number;
  question_engagement_score: number;
  topic_depth_score: number;
  response_time_score: number;

  // Computed scores (0-100)
  emotional_depth_score: number;
  investment_score: number;
  combined_score: number;

  // Raw metrics
  message_length: number;
  word_count: number;
  question_count: number;
  response_time_ms: number | null;

  created_at: Timestamp;
}

export interface EngagementSignalInsert {
  anonymous_usage_id: UUID;
  session_id?: UUID | null;
  message_number: number;

  // Emotional depth signals
  sentiment_score: number;
  personal_pronoun_density: number;
  vulnerability_score: number;
  emotional_language_score: number;

  // Investment signals
  message_length_score: number;
  question_engagement_score: number;
  topic_depth_score: number;
  response_time_score: number;

  // Computed scores
  emotional_depth_score: number;
  investment_score: number;
  combined_score: number;

  // Raw metrics
  message_length: number;
  word_count: number;
  question_count: number;
  response_time_ms?: number | null;
}

export interface EngagementConfig {
  conversionThreshold: number;
  minMessages: number;
  maxMessages: number;
}

export interface EngagementAnalysis {
  // Individual signal scores (0-100)
  sentimentScore: number;
  personalPronounDensity: number;
  vulnerabilityScore: number;
  emotionalLanguageScore: number;
  messageLengthScore: number;
  questionEngagementScore: number;
  topicDepthScore: number;
  responseTimeScore: number;

  // Composite scores (0-100)
  emotionalDepthScore: number;
  investmentScore: number;
  combinedScore: number;

  // Raw metrics
  messageLength: number;
  wordCount: number;
  questionCount: number;
  responseTimeMs: number | null;
}

export interface ConversionDecision {
  shouldTrigger: boolean;
  reason: 'engagement_threshold' | 'max_messages' | 'none';
  messageNumber: number;
  cumulativeScore: number;
  threshold: number;
}

/**
 * Extended anonymous usage with engagement fields
 */
export interface AnonymousUsageWithEngagement {
  id: UUID;
  device_fingerprint: string;
  ip_address: string | null;
  messages_used: number;
  last_session_id: UUID | null;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
  converted_user_id: UUID | null;
  engagement_score: number;
  peak_engagement_score: number;
  conversion_triggered_at: Timestamp | null;
  conversion_trigger_message: number | null;
}

// ============================================================================
// Ad Tracking Types
// ============================================================================

export type AdPlatform = 'google_ads' | 'facebook_ads';
export type AdAccountStatus = 'active' | 'disconnected' | 'error' | 'pending';
export type AdConversionType = 'signup' | 'first_payment' | 'subscription' | 'purchase';

/**
 * Connected ad platform account with OAuth credentials
 */
export interface AdAccount {
  id: UUID;
  platform: AdPlatform;
  account_id: string;
  account_name: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: Timestamp | null;
  currency: string;
  timezone: string | null;
  status: AdAccountStatus;
  last_sync_at: Timestamp | null;
  sync_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AdAccountInsert {
  platform: AdPlatform;
  account_id: string;
  account_name?: string | null;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: Timestamp | null;
  currency?: string;
  timezone?: string | null;
  status?: AdAccountStatus;
}

export interface AdAccountUpdate {
  account_name?: string | null;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: Timestamp | null;
  currency?: string;
  timezone?: string | null;
  status?: AdAccountStatus;
  last_sync_at?: Timestamp | null;
  sync_error?: string | null;
}

/**
 * Cached campaign data from ad platforms
 */
export interface AdCampaign {
  id: UUID;
  ad_account_id: UUID;
  platform_campaign_id: string;
  name: string;
  status: string | null;
  objective: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AdCampaignInsert {
  ad_account_id: UUID;
  platform_campaign_id: string;
  name: string;
  status?: string | null;
  objective?: string | null;
}

export interface AdCampaignUpdate {
  name?: string;
  status?: string | null;
  objective?: string | null;
}

/**
 * Daily ad spend data synced from platforms
 */
export interface AdSpendDaily {
  id: UUID;
  ad_account_id: UUID;
  campaign_id: UUID | null;
  platform_campaign_id: string | null;
  date: Date;
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
  synced_at: Timestamp;
}

export interface AdSpendDailyInsert {
  ad_account_id: UUID;
  campaign_id?: UUID | null;
  platform_campaign_id?: string | null;
  date: Date;
  spend_cents?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  currency?: string;
}

export interface AdSpendDailyUpsert {
  ad_account_id: UUID;
  platform_campaign_id: string;
  date: Date;
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency?: string;
}

/**
 * User conversion linked to ad campaigns for ROAS calculation
 */
export interface AdConversion {
  id: UUID;
  user_id: UUID;
  conversion_type: AdConversionType;
  campaign_id: UUID | null;
  platform_campaign_id: string | null;
  platform: AdPlatform | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  revenue_cents: number;
  ltv_cents: number;
  conversion_date: Date;
  created_at: Timestamp;
}

export interface AdConversionInsert {
  user_id: UUID;
  conversion_type: AdConversionType;
  campaign_id?: UUID | null;
  platform_campaign_id?: string | null;
  platform?: AdPlatform | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  revenue_cents?: number;
  ltv_cents?: number;
  conversion_date?: Date;
}

export interface AdConversionUpdate {
  campaign_id?: UUID | null;
  ltv_cents?: number;
}

/**
 * Pre-calculated lifetime value per user
 */
export interface UserLtv {
  user_id: UUID;
  total_payments_cents: number;
  subscription_revenue_cents: number;
  token_revenue_cents: number;
  ltv_cents: number;
  first_payment_at: Timestamp | null;
  last_payment_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserLtvInsert {
  user_id: UUID;
  total_payments_cents?: number;
  subscription_revenue_cents?: number;
  token_revenue_cents?: number;
  ltv_cents?: number;
  first_payment_at?: Timestamp | null;
  last_payment_at?: Timestamp | null;
}

export interface UserLtvUpdate {
  total_payments_cents?: number;
  subscription_revenue_cents?: number;
  token_revenue_cents?: number;
  ltv_cents?: number;
  first_payment_at?: Timestamp | null;
  last_payment_at?: Timestamp | null;
}

/**
 * Campaign metrics for analytics
 */
export interface CampaignMetrics {
  campaign_id: UUID;
  campaign_name: string;
  platform: AdPlatform;
  total_spend_cents: number;
  total_impressions: number;
  total_clicks: number;
  signup_count: number;
  conversion_count: number;
  total_revenue_cents: number;
  total_ltv_cents: number;
}

/**
 * Overview metrics for ad dashboard
 */
export interface AdOverviewMetrics {
  total_spend_cents: number;
  total_impressions: number;
  total_clicks: number;
  total_signups: number;
  total_conversions: number;
  total_revenue_cents: number;
  total_ltv_cents: number;
  spend_by_platform: Record<string, number>;
  signups_by_platform: Record<string, number>;
}

/**
 * Daily spend trend data point
 */
export interface SpendTrendPoint {
  date: Date;
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

/**
 * UTM attribution stats
 */
export interface UtmAttributionStats {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  signup_count: number;
  conversion_count: number;
  total_revenue_cents: number;
  total_ltv_cents: number;
}

// ============================================================================
// SEO Page Types
// ============================================================================

export type SeoPageStatus = 'draft' | 'generating' | 'published' | 'archived';

/**
 * JSON structure for SEO page generated content
 */
export interface SeoPageContentJson {
  headline?: string;
  tagline?: string;
  personalitySummary?: string;
  keyTraits?: string[];
  conversationStarters?: string[];
  [key: string]: unknown;
}

/**
 * SEO page database record
 */
export interface SeoPage {
  id: UUID;
  companion_id: UUID;
  slug: string;
  title: string;
  meta_description: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  content_html: string;
  content_json: SeoPageContentJson;
  status: SeoPageStatus;
  version: number;
  published_at: Timestamp | null;
  generated_by_model: string | null;
  generation_error: string | null;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * SEO page insert/create payload
 */
export interface SeoPageInsert {
  id?: UUID;
  companion_id: UUID;
  slug: string;
  title: string;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  content_html?: string;
  content_json?: SeoPageContentJson;
  status?: SeoPageStatus;
  created_by?: UUID | null;
}

/**
 * SEO page update payload
 */
export interface SeoPageUpdate {
  title?: string;
  meta_description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  content_html?: string;
  content_json?: SeoPageContentJson;
  status?: SeoPageStatus;
  published_at?: Timestamp | null;
  generated_by_model?: string | null;
  generation_error?: string | null;
  version?: number;
}

// ============================================================================
// Ad Creative Types
// ============================================================================

/**
 * Status of an ad creative
 */
export type AdCreativeStatus =
  | 'draft'
  | 'generating_video'
  | 'generating_voiceover'
  | 'ready'
  | 'published'
  | 'failed';

/**
 * Type of creative asset
 */
export type CreativeAssetType =
  | 'source_image'
  | 'video'
  | 'voiceover'
  | 'combined';

/**
 * Status of a creative asset
 */
export type CreativeAssetStatus =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed';

/**
 * Voice settings for ElevenLabs TTS
 */
export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

/**
 * Published platform info for creatives
 */
export interface PublishedPlatformInfo {
  google?: {
    asset_id?: string;
    ad_id?: string;
    campaign_id?: string;
    published_at?: string;
  };
  facebook?: {
    video_id?: string;
    creative_id?: string;
    ad_id?: string;
    ad_set_id?: string;
    published_at?: string;
  };
}

/**
 * Ad creative database record
 */
export interface AdCreative {
  id: UUID;
  user_id: UUID | null;
  companion_id: UUID | null;
  name: string;
  description: string | null;
  status: AdCreativeStatus;
  // Video configuration
  video_model_id: string | null;
  source_image_url: string | null;
  source_image_s3_key: string | null;
  video_prompt: string | null;
  video_duration_seconds: number;
  width: number;
  height: number;
  // Audio configuration
  script_text: string | null;
  voice_id: string | null;
  voice_settings: VoiceSettings | null;
  // Output URLs
  video_url: string | null;
  video_s3_key: string | null;
  voiceover_url: string | null;
  voiceover_s3_key: string | null;
  final_video_url: string | null;
  final_video_s3_key: string | null;
  thumbnail_url: string | null;
  thumbnail_s3_key: string | null;
  file_size_bytes: number | null;
  // Publishing status
  published_platforms: PublishedPlatformInfo | null;
  // Billing
  token_cost: number;
  is_admin_created: boolean;
  // Generation tracking
  generation_started_at: Timestamp | null;
  generation_completed_at: Timestamp | null;
  generation_error: string | null;
  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * Ad creative insert payload
 */
export interface AdCreativeInsert {
  id?: UUID;
  user_id?: UUID | null;
  companion_id?: UUID | null;
  name: string;
  description?: string | null;
  status?: AdCreativeStatus;
  // Video configuration
  video_model_id?: string | null;
  source_image_url?: string | null;
  source_image_s3_key?: string | null;
  video_prompt?: string | null;
  video_duration_seconds?: number;
  width?: number;
  height?: number;
  // Audio configuration
  script_text?: string | null;
  voice_id?: string | null;
  voice_settings?: VoiceSettings | null;
  // Billing
  token_cost?: number;
  is_admin_created?: boolean;
}

/**
 * Ad creative update payload
 */
export interface AdCreativeUpdate {
  name?: string;
  description?: string | null;
  status?: AdCreativeStatus;
  // Video configuration
  video_model_id?: string | null;
  source_image_url?: string | null;
  source_image_s3_key?: string | null;
  video_prompt?: string | null;
  video_duration_seconds?: number;
  width?: number;
  height?: number;
  // Audio configuration
  script_text?: string | null;
  voice_id?: string | null;
  voice_settings?: VoiceSettings | null;
  // Output URLs
  video_url?: string | null;
  video_s3_key?: string | null;
  voiceover_url?: string | null;
  voiceover_s3_key?: string | null;
  final_video_url?: string | null;
  final_video_s3_key?: string | null;
  thumbnail_url?: string | null;
  thumbnail_s3_key?: string | null;
  file_size_bytes?: number | null;
  // Publishing status
  published_platforms?: PublishedPlatformInfo | null;
  // Generation tracking
  generation_started_at?: Timestamp | null;
  generation_completed_at?: Timestamp | null;
  generation_error?: string | null;
}

/**
 * Creative asset generation params
 */
export interface CreativeAssetGenerationParams {
  model_id?: string;
  prompt?: string;
  duration_seconds?: number;
  voice_id?: string;
  voice_settings?: VoiceSettings | null;
  [key: string]: unknown;
}

/**
 * Creative asset database record
 */
export interface CreativeAsset {
  id: UUID;
  creative_id: UUID;
  asset_type: CreativeAssetType;
  status: CreativeAssetStatus;
  // File info
  s3_key: string | null;
  s3_bucket: string | null;
  url: string | null;
  duration_ms: number | null;
  file_size_bytes: number | null;
  format: string | null;
  width: number | null;
  height: number | null;
  // Generation params and metadata
  generation_params: CreativeAssetGenerationParams | null;
  generation_error: string | null;
  processing_time_ms: number | null;
  metadata: JSONObject | null;
  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * Creative asset insert payload
 */
export interface CreativeAssetInsert {
  id?: UUID;
  creative_id: UUID;
  asset_type: CreativeAssetType;
  status?: CreativeAssetStatus;
  // File info
  s3_key?: string | null;
  s3_bucket?: string | null;
  url?: string | null;
  duration_ms?: number | null;
  file_size_bytes?: number | null;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  // Generation params and metadata
  generation_params?: CreativeAssetGenerationParams | null;
  metadata?: JSONObject | null;
}

/**
 * Creative asset update payload
 */
export interface CreativeAssetUpdate {
  status?: CreativeAssetStatus;
  s3_key?: string | null;
  s3_bucket?: string | null;
  url?: string | null;
  duration_ms?: number | null;
  file_size_bytes?: number | null;
  format?: string | null;
  width?: number | null;
  height?: number | null;
  generation_error?: string | null;
  processing_time_ms?: number | null;
  metadata?: JSONObject | null;
}

/**
 * Video model info for creative generation
 */
export interface VideoModelInfo {
  id: string;
  display_name: string;
  provider: string;
  max_duration_seconds: number;
  supported_resolutions: Array<{ width: number; height: number }>;
  cost_per_second_cents: number;
  capabilities: string[];
}
