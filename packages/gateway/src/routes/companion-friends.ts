/**
 * Companion Friends Routes
 * Manage companion-to-companion friendships for group chat.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  getCompanionFriendsService,
  AddFriendInputSchema,
  UpdateFriendshipInputSchema,
} from '../services/companion-friends.js';
import { logger } from '../observability/logger.js';

// Request schemas
const ListFriendsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  relationshipType: z.string().optional(),
});

const AddFriendBodySchema = AddFriendInputSchema;

const UpdateFriendshipBodySchema = UpdateFriendshipInputSchema;

/**
 * Map friend record to API response
 * Handles both flat (from listFriends) and nested (from other queries) formats
 */
function mapFriendResponse(friend: {
  id: string;
  companion_id: string;
  friend_companion_id: string;
  relationship_type: string | null;
  how_they_met: string | null;
  nickname: string | null;
  familiarity_level: number;
  created_at: Date;
  updated_at: Date;
  // Flat properties from listFriends
  friendName?: string;
  friendAvatarUrl?: string | null;
  friendStatus?: string;
  friendIsPublic?: boolean;
}) {
  return {
    id: friend.id,
    companionId: friend.companion_id,
    friendCompanionId: friend.friend_companion_id,
    relationshipType: friend.relationship_type,
    howTheyMet: friend.how_they_met,
    nickname: friend.nickname,
    familiarityLevel: friend.familiarity_level,
    createdAt: friend.created_at,
    updatedAt: friend.updated_at,
    friendCompanion: friend.friendName
      ? {
          id: friend.friend_companion_id,
          name: friend.friendName,
          avatarUrl: friend.friendAvatarUrl ?? null,
          status: friend.friendStatus ?? 'active',
          isPublic: friend.friendIsPublic ?? false,
        }
      : undefined,
  };
}

/**
 * Register companion friends routes
 */
export async function companionFriendsRoutes(app: FastifyInstance): Promise<void> {
  const friendsService = getCompanionFriendsService();

  /**
   * GET /companions/:companionId/friends - List friends for a companion
   */
  app.get(
    '/:companionId/friends',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { companionId } = request.params as { companionId: string };

      const queryResult = ListFriendsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid query parameters',
          details: queryResult.error.issues,
        });
      }

      try {
        const result = await friendsService.listFriends(
          request.user!.userId,
          companionId,
          queryResult.data
        );

        return reply.send({
          friends: result.data.map(mapFriendResponse),
          total: result.total,
          limit: result.limit,
          offset: queryResult.data.offset ?? 0,
        });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Companion not found') {
            return reply.status(404).send({ error: 'Not Found', message: error.message });
          }
          if (error.message === 'You do not own this companion') {
            return reply.status(403).send({ error: 'Forbidden', message: error.message });
          }
        }
        throw error;
      }
    }
  );

  /**
   * POST /companions/:companionId/friends - Add a friend to a companion
   */
  app.post(
    '/:companionId/friends',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { companionId } = request.params as { companionId: string };

      const parseResult = AddFriendBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: parseResult.error.issues,
        });
      }

      try {
        const friendship = await friendsService.addFriend(
          request.user!.userId,
          companionId,
          parseResult.data
        );

        logger.info(
          {
            companionId,
            friendCompanionId: parseResult.data.friendCompanionId,
            userId: request.user!.userId,
          },
          'Friend added via API'
        );

        return reply.status(201).send({
          id: friendship.id,
          companionId: friendship.companion_id,
          friendCompanionId: friendship.friend_companion_id,
          relationshipType: friendship.relationship_type,
          howTheyMet: friendship.how_they_met,
          familiarityLevel: friendship.familiarity_level,
          createdAt: friendship.created_at,
        });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Companion not found' || error.message === 'Friend companion not found') {
            return reply.status(404).send({ error: 'Not Found', message: error.message });
          }
          if (
            error.message === 'You do not own this companion' ||
            error.message === 'Cannot add a private companion from another user as a friend'
          ) {
            return reply.status(403).send({ error: 'Forbidden', message: error.message });
          }
          if (
            error.message === 'Companion must be active to add friends' ||
            error.message === 'Friend companion must be active' ||
            error.message === 'These companions are already friends'
          ) {
            return reply.status(400).send({ error: 'Bad Request', message: error.message });
          }
        }
        throw error;
      }
    }
  );

  /**
   * PATCH /companions/:companionId/friends/:friendId - Update friendship metadata
   */
  app.patch(
    '/:companionId/friends/:friendId',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { companionId, friendId } = request.params as {
        companionId: string;
        friendId: string;
      };

      const parseResult = UpdateFriendshipBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: parseResult.error.issues,
        });
      }

      try {
        const friendship = await friendsService.updateFriendship(
          request.user!.userId,
          companionId,
          friendId,
          parseResult.data
        );

        logger.debug(
          { companionId, friendId, updates: parseResult.data },
          'Friendship updated via API'
        );

        return reply.send({
          id: friendship.id,
          companionId: friendship.companion_id,
          friendCompanionId: friendship.friend_companion_id,
          relationshipType: friendship.relationship_type,
          nickname: friendship.nickname,
          familiarityLevel: friendship.familiarity_level,
          updatedAt: friendship.updated_at,
        });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Companion not found' || error.message === 'Friendship not found') {
            return reply.status(404).send({ error: 'Not Found', message: error.message });
          }
          if (error.message === 'You do not own this companion') {
            return reply.status(403).send({ error: 'Forbidden', message: error.message });
          }
        }
        throw error;
      }
    }
  );

  /**
   * DELETE /companions/:companionId/friends/:friendId - Remove a friend
   */
  app.delete(
    '/:companionId/friends/:friendId',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { companionId, friendId } = request.params as {
        companionId: string;
        friendId: string;
      };

      try {
        await friendsService.removeFriend(request.user!.userId, companionId, friendId);

        logger.info(
          { companionId, friendId, userId: request.user!.userId },
          'Friend removed via API'
        );

        return reply.status(204).send();
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Companion not found') {
            return reply.status(404).send({ error: 'Not Found', message: error.message });
          }
          if (error.message === 'You do not own this companion') {
            return reply.status(403).send({ error: 'Forbidden', message: error.message });
          }
          if (error.message === 'These companions are not friends') {
            return reply.status(400).send({ error: 'Bad Request', message: error.message });
          }
        }
        throw error;
      }
    }
  );

  /**
   * GET /companions/:companionId/friends/:friendId/check - Check if two companions are friends
   */
  app.get(
    '/:companionId/friends/:friendId/check',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { companionId, friendId } = request.params as {
        companionId: string;
        friendId: string;
      };

      try {
        const areFriends = await friendsService.areFriends(companionId, friendId);

        return reply.send({
          companionId,
          friendCompanionId: friendId,
          areFriends,
        });
      } catch (error) {
        throw error;
      }
    }
  );
}
