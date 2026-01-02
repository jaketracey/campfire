/**
 * Services Index
 * Central export for all service modules
 */

// Events service
import { getEventsService as _getEventsService } from './events.js';
export {
  EventsService,
  getEventsService,
} from './events.js';
export type {
  EventContext,
  CreateEventOptions,
  BatchEventOptions,
} from './events.js';

// Auth service
import { getAuthService as _getAuthService } from './auth.js';
export {
  AuthService,
  getAuthService,
  RegisterInputSchema,
  LoginInputSchema,
  ChangePasswordInputSchema,
  ResetPasswordInputSchema,
} from './auth.js';
export type {
  RegisterInput,
  LoginInput,
  ChangePasswordInput,
  ResetPasswordInput,
  AuthResult,
  TokenPayload,
  AuthError,
} from './auth.js';

// Users service
import { getUsersService as _getUsersService } from './users.js';
export {
  UsersService,
  getUsersService,
  UpdateProfileInputSchema,
  UpdatePreferencesInputSchema,
  OnboardingInputSchema,
} from './users.js';
export type {
  UpdateProfileInput,
  UpdatePreferencesInput,
  OnboardingInput,
  UserPublicProfile,
  UserSettings,
  UserPreferences,
  UserStats,
} from './users.js';

// Companions service
import { getCompanionsService as _getCompanionsService } from './companions.js';
export {
  CompanionsService,
  getCompanionsService,
  CreateCompanionInputSchema,
  UpdateCompanionInputSchema,
  CompanionSpecSchema,
  IdentitySchema,
  PersonalitySchema,
  VoiceSchema,
  VisualStyleSchema,
  BoundariesSchema,
  MemoryConsentSchema,
} from './companions.js';
export type {
  CreateCompanionInput,
  UpdateCompanionInput,
  CompanionSummary,
  CompanionDetails,
  VoicePreview,
} from './companions.js';

// Companion Friends service (Group Chat)
import { getCompanionFriendsService as _getCompanionFriendsService } from './companion-friends.js';
export {
  CompanionFriendsService,
  getCompanionFriendsService,
  AddFriendInputSchema,
  UpdateFriendshipInputSchema,
} from './companion-friends.js';
export type {
  AddFriendInput,
  UpdateFriendshipInput,
} from './companion-friends.js';

// Sessions service
import { getSessionsService as _getSessionsService } from './sessions.js';
export {
  SessionsService,
  getSessionsService,
  StartSessionInputSchema,
  AddTurnInputSchema,
  EndSessionInputSchema,
} from './sessions.js';
export type {
  StartSessionInput,
  AddTurnInput,
  EndSessionInput,
  SessionSummary,
  TurnMetrics,
  ActiveSessionInfo,
} from './sessions.js';

// Memories service
import { getMemoriesService as _getMemoriesService } from './memories.js';
export {
  MemoriesService,
  getMemoriesService,
  CreateMemoryInputSchema,
  UpdateMemoryInputSchema,
  SearchMemoriesInputSchema,
} from './memories.js';
export type {
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchMemoriesInput,
  MemoryWithRelevance,
  MemoryContext,
  MemoryCluster,
} from './memories.js';

// Billing service
import { getBillingService as _getBillingService } from './billing.js';
export {
  BillingService,
  getBillingService,
  CreateSubscriptionInputSchema,
  UpdateSubscriptionInputSchema,
  RecordUsageInputSchema,
} from './billing.js';
export type {
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  RecordUsageInput,
  PlanLimits,
  SubscriptionInfo,
  InvoiceSummary,
} from './billing.js';

// Voice service
import { getVoiceService as _getVoiceService } from './voice.js';
export { VoiceService, getVoiceService } from './voice.js';
export type { VoiceTuning, STTSession, TTSOptions } from './voice.js';

// Tenets service
import { getTenetsService as _getTenetsService } from './tenets.js';
export {
  TenetsService,
  getTenetsService,
  CreateTenetInputSchema,
  UpdateTenetInputSchema,
  TenetCategorySchema,
  TenetPrioritySchema,
} from './tenets.js';
export type {
  CreateTenetInput,
  UpdateTenetInput,
  Tenet,
  CoreTenet,
  SituationalTenetMatch,
  TenetCategory,
  TenetPriority,
} from './tenets.js';

// LLM Usage service
import { getLLMUsageService as _getLLMUsageService } from './llm-usage.js';
export {
  LLMUsageService,
  getLLMUsageService,
  RecordLLMUsageInputSchema,
  UpdateBudgetInputSchema,
  CostQueryInputSchema,
} from './llm-usage.js';
export type {
  RecordLLMUsageInput,
  UpdateBudgetInput,
  CostQueryInput,
  BudgetCheckResult,
  UsageAnalytics,
  AlertConfig,
} from './llm-usage.js';

/**
 * Initialize all services
 * Call this at application startup to ensure singleton instances are created
 */
export function initializeServices(): void {
  _getEventsService();
  _getAuthService();
  _getUsersService();
  _getCompanionsService();
  _getCompanionFriendsService();
  _getSessionsService();
  _getMemoriesService();
  _getBillingService();
  _getVoiceService();
  _getTenetsService();
  _getLLMUsageService();
}

/**
 * Get all service instances
 * Useful for dependency injection or testing
 */
export function getServices() {
  return {
    events: _getEventsService(),
    auth: _getAuthService(),
    users: _getUsersService(),
    companions: _getCompanionsService(),
    companionFriends: _getCompanionFriendsService(),
    sessions: _getSessionsService(),
    memories: _getMemoriesService(),
    billing: _getBillingService(),
    voice: _getVoiceService(),
    tenets: _getTenetsService(),
    llmUsage: _getLLMUsageService(),
  };
}

/**
 * Service context type for dependency injection
 */
export interface ServiceContext {
  events: ReturnType<typeof _getEventsService>;
  auth: ReturnType<typeof _getAuthService>;
  users: ReturnType<typeof _getUsersService>;
  companions: ReturnType<typeof _getCompanionsService>;
  companionFriends: ReturnType<typeof _getCompanionFriendsService>;
  sessions: ReturnType<typeof _getSessionsService>;
  memories: ReturnType<typeof _getMemoriesService>;
  billing: ReturnType<typeof _getBillingService>;
  voice: ReturnType<typeof _getVoiceService>;
  tenets: ReturnType<typeof _getTenetsService>;
  llmUsage: ReturnType<typeof _getLLMUsageService>;
}
