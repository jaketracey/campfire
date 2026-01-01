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

/**
 * Initialize all services
 * Call this at application startup to ensure singleton instances are created
 */
export function initializeServices(): void {
  _getEventsService();
  _getAuthService();
  _getUsersService();
  _getCompanionsService();
  _getSessionsService();
  _getMemoriesService();
  _getBillingService();
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
    sessions: _getSessionsService(),
    memories: _getMemoriesService(),
    billing: _getBillingService(),
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
  sessions: ReturnType<typeof _getSessionsService>;
  memories: ReturnType<typeof _getMemoriesService>;
  billing: ReturnType<typeof _getBillingService>;
}
