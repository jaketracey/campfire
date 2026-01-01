import { z } from 'zod';

/**
 * Memory retention period
 */
export const MemoryRetentionPeriodSchema = z.enum([
  'session_only',     // Deleted after session ends
  '7_days',           // Retained for 7 days
  '30_days',          // Retained for 30 days
  '90_days',          // Retained for 90 days
  '1_year',           // Retained for 1 year
  'indefinite',       // Retained indefinitely (until manual deletion)
]);

export type MemoryRetentionPeriod = z.infer<typeof MemoryRetentionPeriodSchema>;

/**
 * Memory type consent settings
 */
export const MemoryTypeConsentSchema = z.object({
  /** Allow storing this type of memory */
  allowed: z.boolean(),
  /** Retention period for this type */
  retentionPeriod: MemoryRetentionPeriodSchema,
  /** Require explicit confirmation before storing */
  requireConfirmation: z.boolean().default(false),
});

export type MemoryTypeConsent = z.infer<typeof MemoryTypeConsentSchema>;

/**
 * Detailed memory consent by category
 */
export const MemoryConsentByTypeSchema = z.object({
  /** Facts about the user */
  facts: MemoryTypeConsentSchema,
  /** User preferences */
  preferences: MemoryTypeConsentSchema,
  /** Shared experiences */
  experiences: MemoryTypeConsentSchema,
  /** Relationship context */
  relationships: MemoryTypeConsentSchema,
  /** User goals */
  goals: MemoryTypeConsentSchema,
  /** Routines and habits */
  routines: MemoryTypeConsentSchema,
  /** Emotional patterns */
  emotional: MemoryTypeConsentSchema,
});

export type MemoryConsentByType = z.infer<typeof MemoryConsentByTypeSchema>;

/**
 * Knowledge graph consent settings
 */
export const KnowledgeGraphConsentSchema = z.object({
  /** Allow building knowledge graph */
  allowKnowledgeGraph: z.boolean(),
  /** Allow entity extraction */
  allowEntityExtraction: z.boolean(),
  /** Allow relationship mapping */
  allowRelationshipMapping: z.boolean(),
  /** Retention period for KG data */
  retentionPeriod: MemoryRetentionPeriodSchema,
});

export type KnowledgeGraphConsent = z.infer<typeof KnowledgeGraphConsentSchema>;

/**
 * Data export settings
 */
export const DataExportSettingsSchema = z.object({
  /** Allow vault export */
  allowVaultExport: z.boolean(),
  /** Allow memory export */
  allowMemoryExport: z.boolean(),
  /** Allow conversation export */
  allowConversationExport: z.boolean(),
  /** Export format preferences */
  preferredFormats: z.array(z.enum(['json', 'markdown', 'csv', 'pdf'])),
});

export type DataExportSettings = z.infer<typeof DataExportSettingsSchema>;

/**
 * Complete memory consent policy
 * Section 7.1 of plan.md: memory consent policy
 */
export const MemoryConsentPolicySchema = z.object({
  /** Overall memory enabled */
  memoryEnabled: z.boolean(),
  /** Long-term memory enabled */
  longTermMemoryEnabled: z.boolean(),
  /** Default retention period */
  defaultRetentionPeriod: MemoryRetentionPeriodSchema,
  /** Per-type consent settings */
  byType: MemoryConsentByTypeSchema,
  /** Knowledge graph consent */
  knowledgeGraph: KnowledgeGraphConsentSchema,
  /** Data export settings */
  export: DataExportSettingsSchema,
  /** Allow proactive memory suggestions */
  allowProactiveMemorySuggestions: z.boolean().default(true),
  /** Allow memory correction by user */
  allowMemoryCorrection: z.boolean().default(true),
  /** Notify user when memories are stored */
  notifyOnMemoryStorage: z.boolean().default(false),
  /** Last consent update timestamp */
  lastUpdated: z.string().datetime({ offset: true }),
  /** Policy version */
  policyVersion: z.string().min(1),
});

export type MemoryConsentPolicy = z.infer<typeof MemoryConsentPolicySchema>;

/**
 * Default memory consent policy (privacy-preserving defaults)
 */
export const DEFAULT_MEMORY_CONSENT_POLICY: MemoryConsentPolicy = {
  memoryEnabled: true,
  longTermMemoryEnabled: true,
  defaultRetentionPeriod: '90_days',
  byType: {
    facts: { allowed: true, retentionPeriod: '90_days', requireConfirmation: false },
    preferences: { allowed: true, retentionPeriod: '90_days', requireConfirmation: false },
    experiences: { allowed: true, retentionPeriod: '90_days', requireConfirmation: false },
    relationships: { allowed: true, retentionPeriod: '90_days', requireConfirmation: true },
    goals: { allowed: true, retentionPeriod: '90_days', requireConfirmation: false },
    routines: { allowed: true, retentionPeriod: '90_days', requireConfirmation: false },
    emotional: { allowed: true, retentionPeriod: '30_days', requireConfirmation: true },
  },
  knowledgeGraph: {
    allowKnowledgeGraph: true,
    allowEntityExtraction: true,
    allowRelationshipMapping: true,
    retentionPeriod: '90_days',
  },
  export: {
    allowVaultExport: true,
    allowMemoryExport: true,
    allowConversationExport: true,
    preferredFormats: ['json', 'markdown'],
  },
  allowProactiveMemorySuggestions: true,
  allowMemoryCorrection: true,
  notifyOnMemoryStorage: false,
  lastUpdated: new Date().toISOString(),
  policyVersion: '1.0.0',
};
