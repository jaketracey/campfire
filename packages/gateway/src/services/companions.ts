/**
 * Companions Service
 * Business logic for companion creation, management, and configuration.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  getCompanionsRepository,
  getBillingRepository,
  type CompanionWithAvatar,
  type CompanionListFilters,
  type PaginatedResult,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';
import type {
  Companion,
  CompanionInsert,
  CompanionSpec,
  CompanionStatus,
  CompanionAvatar,
  CompanionAvatarInsert,
  AvatarAssetType,
} from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const IdentitySchema = z.object({
  name: z.string().min(1).max(100),
  pronouns: z.string().min(1).max(50),
  address_style: z.string().min(1).max(100),
});

export const PersonalitySchema = z.object({
  archetype: z.string().min(1).max(100),
  traits: z.record(z.number().min(0).max(1)),
});

export const VoiceSchema = z.object({
  provider: z.string().min(1),
  voice_id: z.string().min(1),
  settings: z.record(z.unknown()).optional(),
});

export const VisualStyleSchema = z.object({
  style_type: z.string().min(1),
  palette: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  reference_assets: z.array(z.string()).optional(),
});

export const BoundariesSchema = z.object({
  relationship_pacing: z.enum(['slow', 'moderate', 'fast']),
  topics_avoid: z.array(z.string()).optional(),
  content_rating: z.enum(['G', 'PG', 'PG-13', 'R']),
});

export const MemoryConsentSchema = z.object({
  allow_long_term: z.boolean(),
  allow_kg_extraction: z.boolean(),
  retention_days: z.number().int().positive().optional(),
});

export const CompanionSpecSchema = z.object({
  identity: IdentitySchema,
  personality: PersonalitySchema,
  voice: VoiceSchema,
  visual_style: VisualStyleSchema,
  boundaries: BoundariesSchema,
  memory_consent: MemoryConsentSchema,
});

export const CreateCompanionInputSchema = z.object({
  name: z.string().min(1).max(100),
  spec: CompanionSpecSchema,
});

export const UpdateCompanionInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  spec: CompanionSpecSchema.partial().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type CreateCompanionInput = z.infer<typeof CreateCompanionInputSchema>;
export type UpdateCompanionInput = z.infer<typeof UpdateCompanionInputSchema>;

export interface CompanionSummary {
  id: string;
  name: string;
  status: CompanionStatus;
  avatarUrl: string | null;
  lastSessionAt: Date | null;
  sessionCount: number;
}

export interface CompanionDetails extends Companion {
  avatar: CompanionAvatar | null;
  sessionCount: number;
  memoryCount: number;
  entityCount: number;
}

export interface VoicePreview {
  provider: string;
  voiceId: string;
  sampleUrl: string;
}

// ============================================================================
// Service
// ============================================================================

export class CompanionsService {
  private companions = getCompanionsRepository();
  private billing = getBillingRepository();
  private events = getEventsService();

  /**
   * Create a new companion
   */
  async create(
    userId: string,
    input: CreateCompanionInput,
    tx?: TransactionContext
  ): Promise<Companion> {
    const validated = CreateCompanionInputSchema.parse(input);

    // Check companion limit
    const usageCheck = await this.billing.checkUsageLimit(userId, 'companions', tx);
    if (!usageCheck.allowed) {
      throw new Error(`Companion limit reached. You can have up to ${usageCheck.limitAmount} companions.`);
    }

    // Check for duplicate name
    const existing = await this.companions.findByUserIdAndName(userId, validated.name, tx);
    if (existing) {
      throw new Error(`A companion named "${validated.name}" already exists`);
    }

    // Create the companion
    const companion = await this.companions.create({
      user_id: userId,
      name: validated.name,
      spec: validated.spec as CompanionSpec,
      status: 'draft',
    }, tx);

    // Emit creation event
    const context: EventContext = {
      userId,
      sessionId: 'companion-creation',
      traceId: crypto.randomUUID(),
    };

    await this.events.emitCompanionCreated(context, {
      companionId: companion.id,
      name: companion.name,
      spec: companion.spec as Record<string, unknown>,
    });

    logger.info({ userId, companionId: companion.id, name: companion.name }, 'Companion created');
    return companion;
  }

  /**
   * Get a companion by ID
   */
  async getById(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Companion | null> {
    const companion = await this.companions.findById(companionId, tx);

    // Verify ownership
    if (companion && companion.user_id !== userId) {
      return null;
    }

    return companion;
  }

  /**
   * Get a companion with its active avatar
   */
  async getWithAvatar(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<CompanionWithAvatar | null> {
    const companion = await this.companions.findByIdWithAvatar(companionId, tx);

    if (companion && companion.user_id !== userId) {
      return null;
    }

    return companion;
  }

  /**
   * Update a companion
   */
  async update(
    userId: string,
    companionId: string,
    input: UpdateCompanionInput,
    tx?: TransactionContext
  ): Promise<Companion> {
    const validated = UpdateCompanionInputSchema.parse(input);

    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    // Check for duplicate name if changing
    if (validated.name && validated.name !== companion.name) {
      const existing = await this.companions.findByUserIdAndName(userId, validated.name, tx);
      if (existing) {
        throw new Error(`A companion named "${validated.name}" already exists`);
      }
    }

    const updated = await this.companions.update(companionId, {
      name: validated.name,
      status: validated.status,
    }, tx);

    logger.debug({ userId, companionId }, 'Companion updated');
    return updated;
  }

  /**
   * Update companion spec (creates new version)
   */
  async updateSpec(
    userId: string,
    companionId: string,
    specUpdates: Partial<CompanionSpec>,
    tx?: TransactionContext
  ): Promise<Companion> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    const previousVersion = companion.spec_version;
    const newSpec = {
      ...companion.spec,
      ...specUpdates,
    } as CompanionSpec;

    const updated = await this.companions.updateSpec(companionId, newSpec, tx);

    // Emit spec updated event
    const context: EventContext = {
      userId,
      sessionId: 'companion-update',
      traceId: crypto.randomUUID(),
    };

    await this.events.emitCompanionSpecUpdated(context, {
      companionId,
      previousVersion,
      newVersion: updated.spec_version,
      changes: specUpdates,
    });

    logger.info(
      { userId, companionId, previousVersion, newVersion: updated.spec_version },
      'Companion spec updated'
    );

    return updated;
  }

  /**
   * Activate a companion (set status to active)
   */
  async activate(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Companion> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    // Validate companion is ready for activation
    this.validateForActivation(companion);

    const updated = await this.companions.update(companionId, { status: 'active' }, tx);
    logger.info({ userId, companionId }, 'Companion activated');
    return updated;
  }

  /**
   * Archive a companion
   */
  async archive(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<Companion> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    const updated = await this.companions.archive(companionId, tx);
    logger.info({ userId, companionId }, 'Companion archived');
    return updated;
  }

  /**
   * Delete a companion (hard delete)
   */
  async delete(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<void> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    await this.companions.delete(companionId, tx);
    logger.info({ userId, companionId }, 'Companion deleted');
  }

  /**
   * List user's companions
   */
  async list(
    userId: string,
    filters: Omit<CompanionListFilters, 'userId'> = {},
    tx?: TransactionContext
  ): Promise<PaginatedResult<Companion>> {
    return this.companions.list({ ...filters, userId }, tx);
  }

  /**
   * Get active companions for a user
   */
  async getActiveCompanions(
    userId: string,
    tx?: TransactionContext
  ): Promise<Companion[]> {
    const result = await this.companions.list({
      userId,
      status: 'active',
      limit: 100,
    }, tx);
    return result.data;
  }

  /**
   * Count user's companions
   */
  async count(userId: string, tx?: TransactionContext): Promise<number> {
    return this.companions.countByUser(userId, tx);
  }

  // ===========================================================================
  // Avatar Management
  // ===========================================================================

  /**
   * Add an avatar to a companion
   */
  async addAvatar(
    userId: string,
    companionId: string,
    input: Omit<CompanionAvatarInsert, 'companion_id'>,
    tx?: TransactionContext
  ): Promise<CompanionAvatar> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    const avatar = await this.companions.createAvatar({
      ...input,
      companion_id: companionId,
    }, tx);

    logger.debug({ userId, companionId, avatarId: avatar.id }, 'Avatar added');
    return avatar;
  }

  /**
   * Set the active avatar for a companion
   */
  async setActiveAvatar(
    userId: string,
    companionId: string,
    avatarId: string,
    tx?: TransactionContext
  ): Promise<CompanionAvatar> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    const avatar = await this.companions.setActiveAvatar(avatarId, tx);
    logger.debug({ userId, companionId, avatarId }, 'Active avatar set');
    return avatar;
  }

  /**
   * Get the identity anchor avatar
   */
  async getIdentityAnchor(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<CompanionAvatar | null> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    return this.companions.getIdentityAnchor(companionId, tx);
  }

  /**
   * List avatars for a companion
   */
  async listAvatars(
    userId: string,
    companionId: string,
    tx?: TransactionContext
  ): Promise<CompanionAvatar[]> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    return this.companions.listAvatars(companionId, tx);
  }

  /**
   * Delete an avatar
   */
  async deleteAvatar(
    userId: string,
    companionId: string,
    avatarId: string,
    tx?: TransactionContext
  ): Promise<void> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    await this.companions.deleteAvatar(avatarId, tx);
    logger.debug({ userId, companionId, avatarId }, 'Avatar deleted');
  }

  // ===========================================================================
  // Version History
  // ===========================================================================

  /**
   * Get spec version history
   */
  async getVersionHistory(
    userId: string,
    companionId: string,
    limit: number = 10,
    tx?: TransactionContext
  ): Promise<Array<{ version: number; spec: CompanionSpec; createdAt: Date }>> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    return this.companions.getVersionHistory(companionId, limit, tx);
  }

  /**
   * Restore a specific version
   */
  async restoreVersion(
    userId: string,
    companionId: string,
    version: number,
    tx?: TransactionContext
  ): Promise<Companion> {
    const companion = await this.getById(userId, companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }

    const targetVersion = await this.companions.getVersion(companionId, version, tx);
    if (!targetVersion) {
      throw new Error(`Version ${version} not found`);
    }

    // Update to the restored spec (this creates a new version)
    return this.updateSpec(userId, companionId, targetVersion.spec, tx);
  }

  // ===========================================================================
  // Voice Configuration
  // ===========================================================================

  /**
   * Update companion voice settings
   */
  async updateVoice(
    userId: string,
    companionId: string,
    voiceConfig: CompanionSpec['voice'],
    tx?: TransactionContext
  ): Promise<Companion> {
    const validated = VoiceSchema.parse(voiceConfig);
    return this.updateSpec(userId, companionId, { voice: validated }, tx);
  }

  /**
   * Get available voice providers
   */
  getAvailableVoiceProviders(): Array<{ id: string; name: string }> {
    return [
      { id: 'elevenlabs', name: 'ElevenLabs' },
      { id: 'playht', name: 'PlayHT' },
      { id: 'openai', name: 'OpenAI TTS' },
    ];
  }

  // ===========================================================================
  // Memory Consent
  // ===========================================================================

  /**
   * Update memory consent settings
   */
  async updateMemoryConsent(
    userId: string,
    companionId: string,
    consent: CompanionSpec['memory_consent'],
    tx?: TransactionContext
  ): Promise<Companion> {
    const validated = MemoryConsentSchema.parse(consent);

    const companion = await this.updateSpec(userId, companionId, { memory_consent: validated }, tx);

    // Emit consent event
    const context: EventContext = {
      userId,
      sessionId: 'consent-update',
      traceId: crypto.randomUUID(),
    };

    await this.events.emit({
      type: 'memory.consent.updated',
      payload: {
        companionId,
        consent: validated,
      },
      context,
    });

    return companion;
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate companion is ready for activation
   */
  private validateForActivation(companion: Companion): void {
    const spec = companion.spec;
    const errors: string[] = [];

    if (!spec.identity?.name) {
      errors.push('Companion must have a name');
    }

    if (!spec.voice?.provider || !spec.voice?.voice_id) {
      errors.push('Companion must have voice settings configured');
    }

    if (!spec.boundaries?.content_rating) {
      errors.push('Companion must have content rating set');
    }

    if (errors.length > 0) {
      throw new Error(`Cannot activate companion: ${errors.join(', ')}`);
    }
  }

  /**
   * Get event context for companion operations
   */
  getEventContext(userId: string, companionId?: string): EventContext {
    return this.events.createContextFromRequest(userId, companionId ?? 'companion-management');
  }
}

// Singleton instance
let companionsService: CompanionsService | null = null;

export function getCompanionsService(): CompanionsService {
  if (!companionsService) {
    companionsService = new CompanionsService();
  }
  return companionsService;
}
