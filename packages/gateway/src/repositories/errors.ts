/**
 * Repository Error Types
 * Typed errors for data access operations
 */

/**
 * Base repository error
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RepositoryError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Entity not found error
 */
export class NotFoundError extends RepositoryError {
  constructor(
    public readonly entity: string,
    public readonly id: string,
    cause?: Error
  ) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', cause);
    this.name = 'NotFoundError';
  }
}

/**
 * Duplicate entity error (unique constraint violation)
 */
export class DuplicateError extends RepositoryError {
  constructor(
    public readonly entity: string,
    public readonly field: string,
    public readonly value: string,
    cause?: Error
  ) {
    super(`${entity} with ${field} "${value}" already exists`, 'DUPLICATE', cause);
    this.name = 'DuplicateError';
  }
}

/**
 * Invalid data error (validation failure)
 */
export class ValidationError extends RepositoryError {
  constructor(
    message: string,
    public readonly field?: string,
    cause?: Error
  ) {
    super(message, 'VALIDATION_ERROR', cause);
    this.name = 'ValidationError';
  }
}

/**
 * Foreign key constraint violation
 */
export class ForeignKeyError extends RepositoryError {
  constructor(
    public readonly entity: string,
    public readonly referencedEntity: string,
    public readonly referencedId: string,
    cause?: Error
  ) {
    super(
      `${referencedEntity} not found: ${referencedId} (referenced by ${entity})`,
      'FOREIGN_KEY_VIOLATION',
      cause
    );
    this.name = 'ForeignKeyError';
  }
}

/**
 * Database connection error
 */
export class ConnectionError extends RepositoryError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONNECTION_ERROR', cause);
    this.name = 'ConnectionError';
  }
}

/**
 * Transaction error
 */
export class TransactionError extends RepositoryError {
  constructor(message: string, cause?: Error) {
    super(message, 'TRANSACTION_ERROR', cause);
    this.name = 'TransactionError';
  }
}

/**
 * Check if an error is a PostgreSQL unique constraint violation
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}

/**
 * Check if an error is a PostgreSQL foreign key violation
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === '23503'
  );
}

/**
 * Check if an error is a PostgreSQL not null violation
 */
export function isNotNullViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === '23502'
  );
}

/**
 * Wrap a database error in an appropriate repository error
 */
export function wrapDatabaseError(error: unknown, context: string): RepositoryError {
  if (error instanceof RepositoryError) {
    return error;
  }

  const err = error instanceof Error ? error : new Error(String(error));

  if (isUniqueViolation(error)) {
    return new DuplicateError(context, 'unknown', 'unknown', err);
  }

  if (isForeignKeyViolation(error)) {
    return new ForeignKeyError(context, 'unknown', 'unknown', err);
  }

  return new RepositoryError(`Database error in ${context}: ${err.message}`, 'DATABASE_ERROR', err);
}
