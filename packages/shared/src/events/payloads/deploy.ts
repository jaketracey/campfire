import { z } from 'zod';
import { createEventSchema, type TypedEvent } from '../envelope.js';
import { EventTypes } from '../types.js';

/**
 * Deployment target environment
 */
export const DeployEnvironmentSchema = z.enum(['development', 'staging', 'production']);
export type DeployEnvironment = z.infer<typeof DeployEnvironmentSchema>;

/**
 * Service being deployed
 */
export const DeployServiceSchema = z.enum([
  'gateway',
  'orchestrator',
  'workers',
  'web',
  'marketing',
]);
export type DeployService = z.infer<typeof DeployServiceSchema>;

// ============================================================================
// deploy.started
// ============================================================================

export const DeployStartedPayloadSchema = z.object({
  /** Deployment ID */
  deploymentId: z.string().min(1),
  /** Environment */
  environment: DeployEnvironmentSchema,
  /** Service being deployed */
  service: DeployServiceSchema,
  /** Git commit SHA */
  commitSha: z.string().min(7),
  /** Git branch */
  branch: z.string().min(1),
  /** Container image tag */
  imageTag: z.string().min(1),
  /** Previous version (if updating) */
  previousVersion: z.string().optional(),
  /** New version */
  newVersion: z.string().min(1),
  /** Deployer identity */
  deployedBy: z.string().min(1),
  /** Whether this includes migrations */
  hasMigrations: z.boolean(),
  /** ISO8601 timestamp of start */
  startedAt: z.string().datetime({ offset: true }),
});

export type DeployStartedPayload = z.infer<typeof DeployStartedPayloadSchema>;

export const DeployStartedEventSchema = createEventSchema(
  EventTypes.DEPLOY_STARTED,
  DeployStartedPayloadSchema
);

export type DeployStartedEvent = TypedEvent<
  typeof EventTypes.DEPLOY_STARTED,
  DeployStartedPayload
>;

// ============================================================================
// deploy.completed
// ============================================================================

export const DeployCompletedPayloadSchema = z.object({
  /** Deployment ID */
  deploymentId: z.string().min(1),
  /** Environment */
  environment: DeployEnvironmentSchema,
  /** Service deployed */
  service: DeployServiceSchema,
  /** Total duration in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** Whether smoke tests passed */
  smokeTestsPassed: z.boolean(),
  /** Number of instances deployed */
  instanceCount: z.number().int().positive(),
  /** Health check URL */
  healthCheckUrl: z.string().url().optional(),
  /** ISO8601 timestamp of completion */
  completedAt: z.string().datetime({ offset: true }),
});

export type DeployCompletedPayload = z.infer<typeof DeployCompletedPayloadSchema>;

export const DeployCompletedEventSchema = createEventSchema(
  EventTypes.DEPLOY_COMPLETED,
  DeployCompletedPayloadSchema
);

export type DeployCompletedEvent = TypedEvent<
  typeof EventTypes.DEPLOY_COMPLETED,
  DeployCompletedPayload
>;

// ============================================================================
// deploy.failed
// ============================================================================

export const DeployFailedPayloadSchema = z.object({
  /** Deployment ID */
  deploymentId: z.string().min(1),
  /** Environment */
  environment: DeployEnvironmentSchema,
  /** Service that failed */
  service: DeployServiceSchema,
  /** Failure stage */
  failureStage: z.enum(['build', 'push', 'migration', 'deploy', 'health_check', 'smoke_test', 'rollback']),
  /** Error code */
  errorCode: z.string().min(1),
  /** Error message */
  errorMessage: z.string().min(1),
  /** Whether rollback was attempted */
  rollbackAttempted: z.boolean(),
  /** Whether rollback succeeded */
  rollbackSucceeded: z.boolean().optional(),
  /** Duration until failure in milliseconds */
  durationMs: z.number().int().nonnegative(),
  /** ISO8601 timestamp of failure */
  failedAt: z.string().datetime({ offset: true }),
});

export type DeployFailedPayload = z.infer<typeof DeployFailedPayloadSchema>;

export const DeployFailedEventSchema = createEventSchema(
  EventTypes.DEPLOY_FAILED,
  DeployFailedPayloadSchema
);

export type DeployFailedEvent = TypedEvent<
  typeof EventTypes.DEPLOY_FAILED,
  DeployFailedPayload
>;
