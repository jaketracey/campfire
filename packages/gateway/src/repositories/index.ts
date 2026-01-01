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
export {
  UsersRepository,
  getUsersRepository,
} from './users.js';
export type {
  UserWithProfile,
  UserSession,
  UserSessionInsert,
  UserListFilters,
} from './users.js';

// Companions repository
export {
  CompanionsRepository,
  getCompanionsRepository,
} from './companions.js';
export type {
  CompanionWithAvatar,
  CompanionListFilters,
} from './companions.js';

// Sessions repository
export {
  SessionsRepository,
  getSessionsRepository,
} from './sessions.js';
export type {
  SessionWithStats,
  TurnWithMetrics,
  SessionListFilters,
} from './sessions.js';

// Memories repository
export {
  MemoriesRepository,
  getMemoriesRepository,
} from './memories.js';
export type {
  MemorySearchResult,
  MemoryListFilters,
  MemoryStats,
} from './memories.js';

// Billing repository
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

/**
 * Initialize all repositories
 * Call this at application startup to ensure singleton instances are created
 */
export function initializeRepositories(): void {
  getUsersRepository();
  getCompanionsRepository();
  getSessionsRepository();
  getMemoriesRepository();
  getBillingRepository();
  getVaultRepository();
  getKnowledgeGraphRepository();
}

/**
 * Get all repository instances
 * Useful for dependency injection or testing
 */
export function getRepositories() {
  return {
    users: getUsersRepository(),
    companions: getCompanionsRepository(),
    sessions: getSessionsRepository(),
    memories: getMemoriesRepository(),
    billing: getBillingRepository(),
    vault: getVaultRepository(),
    knowledgeGraph: getKnowledgeGraphRepository(),
  };
}
