import { z } from 'zod';
import { CompanionIdentitySchema } from './identity.js';
import { CompanionPersonalitySchema } from './personality.js';
import { CompanionVoiceProfileSchema } from './voice.js';
import { CompanionVisualStyleSchema } from './visual.js';
import { CompanionBoundariesSchema } from './boundaries.js';
import { MemoryConsentPolicySchema } from './memory-consent.js';

/**
 * Companion spec status
 */
export const CompanionSpecStatusSchema = z.enum([
  'draft',            // Being created
  'active',           // In use
  'archived',         // No longer in use
  'deleted',          // Soft deleted
]);

export type CompanionSpecStatus = z.infer<typeof CompanionSpecStatusSchema>;

/**
 * Complete Companion Spec ("Companion Bible")
 * Section 7.1 of plan.md: The complete companion specification
 *
 * This is the versioned JSON object that defines everything about a companion:
 * - identity (name, pronouns, address style)
 * - personality (archetype + slider values)
 * - voice profile (provider voice id + tuning)
 * - visual style bible (style type, palette, constraints, reference assets)
 * - boundaries + relationship pacing
 * - memory consent policy
 */
export const CompanionSpecSchema = z.object({
  /** Unique companion ID */
  companionId: z.string().min(1),
  /** User ID who owns this companion */
  userId: z.string().min(1),
  /** Spec version (semver) */
  specVersion: z.string().min(1),
  /** Schema version for forward compatibility */
  schemaVersion: z.literal('1.0.0'),
  /** Spec status */
  status: CompanionSpecStatusSchema,

  // Core configuration sections
  /** Identity configuration */
  identity: CompanionIdentitySchema,
  /** Personality configuration */
  personality: CompanionPersonalitySchema,
  /** Voice profile configuration */
  voiceProfile: CompanionVoiceProfileSchema,
  /** Visual style configuration */
  visualStyle: CompanionVisualStyleSchema,
  /** Boundaries and relationship pacing */
  boundaries: CompanionBoundariesSchema,
  /** Memory consent policy */
  memoryConsent: MemoryConsentPolicySchema,

  // Metadata
  /** ISO8601 timestamp of creation */
  createdAt: z.string().datetime({ offset: true }),
  /** ISO8601 timestamp of last update */
  updatedAt: z.string().datetime({ offset: true }),
  /** Preset ID used as base (if any) */
  basePresetId: z.string().optional(),
  /** Tags for organization */
  tags: z.array(z.string()).max(10).optional(),
});

export type CompanionSpec = z.infer<typeof CompanionSpecSchema>;

/**
 * Minimal companion spec for listing/preview
 */
export const CompanionSpecSummarySchema = z.object({
  companionId: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().optional(),
  archetype: z.string(),
  voiceName: z.string(),
  styleType: z.string(),
  status: CompanionSpecStatusSchema,
  avatarUrl: z.string().url().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type CompanionSpecSummary = z.infer<typeof CompanionSpecSummarySchema>;

/**
 * Companion spec update input (partial updates)
 */
export const CompanionSpecUpdateSchema = CompanionSpecSchema.partial().omit({
  companionId: true,
  userId: true,
  createdAt: true,
  schemaVersion: true,
});

export type CompanionSpecUpdate = z.infer<typeof CompanionSpecUpdateSchema>;
