/**
 * Repositories Index
 * Central export for all repository modules
 */

// Error types
export {
  RepositoryError,
  NotFoundError,
  DuplicateError,
  ValidationError,
  ForeignKeyError,
  ConnectionError,
  TransactionError,
  isUniqueViolation,
  isForeignKeyViolation,
  wrapDatabaseError,
} from './errors.js';

// Common types
export type {
  TransactionContext,
  PaginationOptions,
  PaginatedResult,
  SortDirection,
  SortOptions,
  DateRangeFilter,
  BaseRepository,
  CommonFilters,
} from './types.js';

// Users repository
import { getUsersRepository as _getUsersRepository } from './users.js';
export {
  UsersRepository,
  getUsersRepository,
} from './users.js';
export type {
  UserWithProfile,
  UserWithStats,
  UserSession,
  UserSessionInsert,
  UserListFilters,
  OAuthProvider,
  UserOAuthAccount,
  UserOAuthAccountInsert,
} from './users.js';

// Referrals repository
import { getReferralsRepository as _getReferralsRepository } from './referrals.js';
export {
  ReferralsRepository,
  getReferralsRepository,
} from './referrals.js';
export type {
  ReferralStats,
  ReferralWithUser,
} from './referrals.js';

// Companions repository
import { getCompanionsRepository as _getCompanionsRepository } from './companions.js';
export {
  CompanionsRepository,
  getCompanionsRepository,
} from './companions.js';
export type {
  CompanionWithAvatar,
  CompanionListFilters,
} from './companions.js';

// Sessions repository
import { getSessionsRepository as _getSessionsRepository } from './sessions.js';
export {
  SessionsRepository,
  getSessionsRepository,
} from './sessions.js';
export type {
  SessionWithStats,
  SessionListFilters,
  TurnListFilters,
} from './sessions.js';

// Memories repository
import { getMemoriesRepository as _getMemoriesRepository } from './memories.js';
export {
  MemoriesRepository,
  getMemoriesRepository,
} from './memories.js';
export type {
  MemoryWithSimilarity,
  MemoryListFilters,
  MemoryStatus,
  VectorSearchOptions,
  TextSearchOptions,
} from './memories.js';

// Billing repository
import { getBillingRepository as _getBillingRepository } from './billing.js';
export {
  BillingRepository,
  getBillingRepository,
} from './billing.js';
export type {
  SubscriptionWithUsage,
  UsageRecord,
  UsageRecordInsert,
  UsageLimitResult,
  SubscriptionListFilters,
  BillingEventListFilters,
  UsageRecordListFilters,
  UsageAggregation,
} from './billing.js';

// Vault repository
import { getVaultRepository as _getVaultRepository } from './vault.js';
export {
  VaultRepository,
  getVaultRepository,
} from './vault.js';
export type {
  VaultFileWithMetadata,
  VaultFileInsertFull,
  VaultLink,
  VaultLinkInsert,
  RenderStatus,
  RenderJob,
  RenderJobInsert,
  Backlink,
  VaultFileListFilters,
  RenderJobListFilters,
} from './vault.js';

// Knowledge Graph repository
import { getKnowledgeGraphRepository as _getKnowledgeGraphRepository } from './knowledge-graph.js';
export {
  KnowledgeGraphRepository,
  getKnowledgeGraphRepository,
} from './knowledge-graph.js';
export type {
  KGEntityWithStats,
  KGEdgeWithEntities,
  EntitySearchResult,
  TraversalResult,
  EntityListFilters,
  EdgeListFilters,
  RelationshipSummary,
} from './knowledge-graph.js';

// Gifts repository
import { getGiftsRepository as _getGiftsRepository } from './gifts.js';
export {
  GiftsRepository,
  getGiftsRepository,
} from './gifts.js';
export type {
  TokenBalanceWithStats,
  GiftWithDetails,
  GiftMemoryWithGift,
  CreditTokensResult,
  DeductTokensResult,
  TokenTransactionListFilters,
  GiftListFilters,
  GiftMemorySearchResult,
} from './gifts.js';

// Personality Profiles repository
import { getPersonalityProfilesRepository as _getPersonalityProfilesRepository } from './personality-profiles.js';
export {
  PersonalityProfilesRepository,
  getPersonalityProfilesRepository,
} from './personality-profiles.js';
export type {
  UserPersonalityProfile,
  UserPersonalityProfileInsert,
  UserPersonalityProfileUpdate,
  ProfileListFilters,
  UserNeedingAnalysis,
  GreetingStyle,
  PreferredTone,
  VerbosityLevel,
  PersonalityTraits,
} from './personality-profiles.js';

/**
 * Initialize all repositories
 * Call this at application startup to ensure singleton instances are created
 */
export function initializeRepositories(): void {
  _getUsersRepository();
  _getReferralsRepository();
  _getCompanionsRepository();
  _getSessionsRepository();
  _getMemoriesRepository();
  _getBillingRepository();
  _getVaultRepository();
  _getKnowledgeGraphRepository();
  _getGiftsRepository();
  _getPersonalityProfilesRepository();
}

/**
 * Get all repository instances
 * Useful for dependency injection or testing
 */
export function getRepositories() {
  return {
    users: _getUsersRepository(),
    referrals: _getReferralsRepository(),
    companions: _getCompanionsRepository(),
    sessions: _getSessionsRepository(),
    memories: _getMemoriesRepository(),
    billing: _getBillingRepository(),
    vault: _getVaultRepository(),
    knowledgeGraph: _getKnowledgeGraphRepository(),
    gifts: _getGiftsRepository(),
    personalityProfiles: _getPersonalityProfilesRepository(),
  };
}
