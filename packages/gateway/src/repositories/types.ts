/**
 * Repository Type Definitions
 * Common types and interfaces for repository operations
 */

import type postgres from 'postgres';

/**
 * Database transaction context
 */
export type TransactionContext = postgres.TransactionSql;

/**
 * Pagination options
 */
export interface PaginationOptions {
  /** Number of records to return */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  /** Result items */
  data: T[];
  /** Total count (if requested) */
  total?: number;
  /** Whether there are more results */
  hasMore: boolean;
}

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort options
 */
export interface SortOptions<T extends string = string> {
  /** Field to sort by */
  field: T;
  /** Sort direction */
  direction: SortDirection;
}

/**
 * Date range filter
 */
export interface DateRangeFilter {
  /** Start of range (inclusive) */
  from?: Date;
  /** End of range (exclusive) */
  to?: Date;
}

/**
 * Repository base interface for common operations
 */
export interface BaseRepository<T, TInsert, TUpdate = Partial<TInsert>> {
  /** Find by ID */
  findById(id: string, tx?: TransactionContext): Promise<T | null>;

  /** Create a new record */
  create(data: TInsert, tx?: TransactionContext): Promise<T>;

  /** Update a record */
  update(id: string, data: TUpdate, tx?: TransactionContext): Promise<T>;

  /** Delete a record */
  delete(id: string, tx?: TransactionContext): Promise<void>;
}

/**
 * Common query filters
 */
export interface CommonFilters {
  /** Filter by user ID */
  userId?: string;
  /** Filter by companion ID */
  companionId?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by date range */
  dateRange?: DateRangeFilter;
}
