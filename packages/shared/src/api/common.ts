import { z } from 'zod';

/**
 * Standard API error response
 */
export const ApiErrorSchema = z.object({
  /** Error code for programmatic handling */
  code: z.string().min(1),
  /** Human-readable error message */
  message: z.string().min(1),
  /** Additional error details */
  details: z.record(z.unknown()).optional(),
  /** Request ID for support/debugging */
  requestId: z.string().optional(),
  /** Trace ID for distributed tracing */
  traceId: z.string().optional(),
  /** ISO8601 timestamp */
  timestamp: z.string().datetime({ offset: true }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Standard pagination parameters
 */
export const PaginationParamsSchema = z.object({
  /** Number of items per page (default 20, max 100) */
  limit: z.number().int().min(1).max(100).default(20),
  /** Cursor for next page */
  cursor: z.string().optional(),
  /** Offset-based pagination (alternative to cursor) */
  offset: z.number().int().nonnegative().optional(),
});

export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

/**
 * Paginated response wrapper
 */
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    /** Array of items */
    items: z.array(itemSchema),
    /** Total count (if available) */
    total: z.number().int().nonnegative().optional(),
    /** Cursor for next page */
    nextCursor: z.string().nullable(),
    /** Whether there are more items */
    hasMore: z.boolean(),
  });

export type PaginatedResponse<T> = {
  items: T[];
  total?: number;
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * Standard success response wrapper
 */
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    requestId: z.string().optional(),
  });

export type SuccessResponse<T> = {
  success: true;
  data: T;
  requestId?: string;
};

/**
 * Standard error response wrapper
 */
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: ApiErrorSchema,
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Sort direction
 */
export const SortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/**
 * Sort parameters
 */
export const SortParamsSchema = z.object({
  /** Field to sort by */
  sortBy: z.string().min(1),
  /** Sort direction */
  sortDirection: SortDirectionSchema.default('desc'),
});

export type SortParams = z.infer<typeof SortParamsSchema>;

/**
 * Date range filter
 */
export const DateRangeSchema = z.object({
  /** Start date (ISO8601) */
  from: z.string().datetime({ offset: true }).optional(),
  /** End date (ISO8601) */
  to: z.string().datetime({ offset: true }).optional(),
});

export type DateRange = z.infer<typeof DateRangeSchema>;

/**
 * Health check response
 */
export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string().min(1),
  uptime: z.number().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  checks: z.record(z.object({
    status: z.enum(['pass', 'fail', 'warn']),
    latencyMs: z.number().nonnegative().optional(),
    message: z.string().optional(),
  })).optional(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
