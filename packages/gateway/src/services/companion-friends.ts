/**
 * Companion Friends Service
 * Business logic for managing companion-to-companion friendships for group chat.
 */

import crypto from 'crypto';
import { z } from 'zod';
import {
  getCompanionFriendsRepository,
  getCompanionsRepository,
  type CompanionFriendWithDetails,
  type FriendListFilters,
  type PaginatedResult,
} from '../repositories/index.js';
import { getEventsService, type EventContext } from './events.js';
import { logger } from '../observability/logger.js';
import type {
  CompanionFriend,
  CompanionFriendInsert,
} from '../db/types.js';
import type { TransactionContext } from '../repositories/types.js';

// ============================================================================
// Validation Schemas
// ============================================================================

export const AddFriendInputSchema = z.object({
  friendCompanionId: z.string().uuid(),
  relationshipType: z.string().max(50).optional(),
  howTheyMet: z.string().max(500).optional(),
});

export const UpdateFriendshipInputSchema = z.object({
  nickname: z.string().max(100).optional(),
  relationshipType: z.string().max(50).optional(),
  familiarityLevel: z.number().min(0).max(100).optional(),
});

// ============================================================================
// Types
// ============================================================================

export type AddFriendInput = z.infer<typeof AddFriendInputSchema>;
export type UpdateFriendshipInput = z.infer<typeof UpdateFriendshipInputSchema>;

// ============================================================================
// Service
// ============================================================================

export class CompanionFriendsService {
  private friendsRepo = getCompanionFriendsRepository();
  private companionsRepo = getCompanionsRepository();
  private eventsService = getEventsService();

  /**
   * Add a friend to a companion (creates bidirectional friendship)
   */
  async addFriend(
    userId: string,
    companionId: string,
    input: AddFriendInput,
    eventContext?: EventContext,
    tx?: TransactionContext
  ): Promise<CompanionFriend> {
    // Validate ownership of the companion
    const companion = await this.companionsRepo.findById(companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }
    if (companion.user_id !== userId) {
      throw new Error('You do not own this companion');
    }
    if (companion.status !== 'active') {
      throw new Error('Companion must be active to add friends');
    }

    // Validate friend companion exists
    const friendCompanion = await this.companionsRepo.findById(input.friendCompanionId, tx);
    if (!friendCompanion) {
      throw new Error('Friend companion not found');
    }
    if (friendCompanion.status !== 'active') {
      throw new Error('Friend companion must be active');
    }

    // Check if they're already friends
    const alreadyFriends = await this.friendsRepo.areFriends(companionId, input.friendCompanionId, tx);
    if (alreadyFriends) {
      throw new Error('These companions are already friends');
    }

    // If friend is from different user, they must be public
    if (friendCompanion.user_id !== userId && !friendCompanion.is_public) {
      throw new Error('Cannot add a private companion from another user as a friend');
    }

    // Create bidirectional friendship
    const [friendship] = await this.friendsRepo.createBidirectional(
      companionId,
      input.friendCompanionId,
      {
        relationshipType: input.relationshipType,
        howTheyMet: input.howTheyMet,
      },
      tx
    );

    // Emit event
    const context: EventContext = eventContext ?? {
      userId,
      sessionId: null,
      traceId: crypto.randomUUID(),
    };
    await this.eventsService.emit({
      type: 'companion.friend.added',
      payload: {
        companionId,
        friendCompanionId: input.friendCompanionId,
        friendCompanionName: friendCompanion.name,
        relationshipType: input.relationshipType,
      },
      context,
    });

    logger.info(
      { companionId, friendCompanionId: input.friendCompanionId },
      'Friend added to companion'
    );

    return friendship;
  }

  /**
   * Remove a friend from a companion (removes bidirectional friendship)
   */
  async removeFriend(
    userId: string,
    companionId: string,
    friendCompanionId: string,
    eventContext?: EventContext,
    tx?: TransactionContext
  ): Promise<void> {
    // Validate ownership of the companion
    const companion = await this.companionsRepo.findById(companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }
    if (companion.user_id !== userId) {
      throw new Error('You do not own this companion');
    }

    // Check if they're actually friends
    const areFriends = await this.friendsRepo.areFriends(companionId, friendCompanionId, tx);
    if (!areFriends) {
      throw new Error('These companions are not friends');
    }

    // Remove bidirectional friendship
    await this.friendsRepo.deleteBidirectional(companionId, friendCompanionId, tx);

    // Emit event
    const context: EventContext = eventContext ?? {
      userId,
      sessionId: null,
      traceId: crypto.randomUUID(),
    };
    await this.eventsService.emit({
      type: 'companion.friend.removed',
      payload: {
        companionId,
        friendCompanionId,
      },
      context,
    });

    logger.info(
      { companionId, friendCompanionId },
      'Friend removed from companion'
    );
  }

  /**
   * Update friendship metadata
   */
  async updateFriendship(
    userId: string,
    companionId: string,
    friendCompanionId: string,
    input: UpdateFriendshipInput,
    tx?: TransactionContext
  ): Promise<CompanionFriend> {
    // Validate ownership of the companion
    const companion = await this.companionsRepo.findById(companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }
    if (companion.user_id !== userId) {
      throw new Error('You do not own this companion');
    }

    // Find the friendship
    const friendship = await this.friendsRepo.findByCompanionPair(
      companionId,
      friendCompanionId,
      tx
    );
    if (!friendship) {
      throw new Error('Friendship not found');
    }

    // Update the friendship
    const updated = await this.friendsRepo.update(
      friendship.id,
      {
        nickname: input.nickname,
        relationship_type: input.relationshipType,
        familiarity_level: input.familiarityLevel,
      },
      tx
    );

    logger.debug(
      { companionId, friendCompanionId, updates: input },
      'Friendship updated'
    );

    return updated;
  }

  /**
   * List friends for a companion
   */
  async listFriends(
    userId: string,
    companionId: string,
    options?: { limit?: number; offset?: number; relationshipType?: string },
    tx?: TransactionContext
  ): Promise<PaginatedResult<CompanionFriendWithDetails>> {
    // Validate ownership of the companion
    const companion = await this.companionsRepo.findById(companionId, tx);
    if (!companion) {
      throw new Error('Companion not found');
    }
    if (companion.user_id !== userId) {
      throw new Error('You do not own this companion');
    }

    const filters: FriendListFilters = {
      companionId,
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
      relationshipType: options?.relationshipType,
    };

    return this.friendsRepo.listFriends(filters, tx);
  }

  /**
   * Get friend IDs for a companion (for quick lookups)
   */
  async getFriendIds(
    companionId: string,
    tx?: TransactionContext
  ): Promise<string[]> {
    return this.friendsRepo.getFriendIds(companionId, tx);
  }

  /**
   * Check if two companions are friends
   */
  async areFriends(
    companionId: string,
    friendCompanionId: string,
    tx?: TransactionContext
  ): Promise<boolean> {
    return this.friendsRepo.areFriends(companionId, friendCompanionId, tx);
  }
}

// Singleton instance
let instance: CompanionFriendsService | null = null;

export function getCompanionFriendsService(): CompanionFriendsService {
  if (!instance) {
    instance = new CompanionFriendsService();
  }
  return instance;
}
