/**
 * Services Index
 * Central export for all service modules
 */

// Events service
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

// Sessions service
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

/**
 * Initialize all services
 * Call this at application startup to ensure singleton instances are created
 */
export function initializeServices(): void {
  getEventsService();
  getAuthService();
  getUsersService();
  getCompanionsService();
  getSessionsService();
  getMemoriesService();
  getBillingService();
}

/**
 * Get all service instances
 * Useful for dependency injection or testing
 */
export function getServices() {
  return {
    events: getEventsService(),
    auth: getAuthService(),
    users: getUsersService(),
    companions: getCompanionsService(),
    sessions: getSessionsService(),
    memories: getMemoriesService(),
    billing: getBillingService(),
  };
}

/**
 * Service context type for dependency injection
 */
export interface ServiceContext {
  events: ReturnType<typeof getEventsService>;
  auth: ReturnType<typeof getAuthService>;
  users: ReturnType<typeof getUsersService>;
  companions: ReturnType<typeof getCompanionsService>;
  sessions: ReturnType<typeof getSessionsService>;
  memories: ReturnType<typeof getMemoriesService>;
  billing: ReturnType<typeof getBillingService>;
}
