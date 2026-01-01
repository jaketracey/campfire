'use client';

/**
 * Friends Panel Component
 * Displays companion's friends list and allows inviting them to the chat.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Users, UserPlus, Loader2, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  listCompanionFriends,
  type CompanionFriendship,
} from '@/lib/api/companions';

interface FriendsPanelProps {
  companionId: string;
  companionName: string;
  isOpen: boolean;
  onClose: () => void;
  onInviteFriend?: (friend: CompanionFriendship) => void;
  /** List of companion IDs already in the chat */
  activeParticipantIds?: string[];
  /** Whether group chat is currently active */
  isGroupChat?: boolean;
}

export function FriendsPanel({
  companionId,
  companionName,
  isOpen,
  onClose,
  onInviteFriend,
  activeParticipantIds = [],
  isGroupChat = false,
}: FriendsPanelProps) {
  const [friends, setFriends] = useState<CompanionFriendship[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  // Fetch friends on open
  useEffect(() => {
    if (isOpen && companionId) {
      fetchFriends();
    }
  }, [isOpen, companionId]);

  const fetchFriends = useCallback(async () => {
    // Validate companionId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!companionId || !uuidRegex.test(companionId)) {
      setError('Invalid companion ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await listCompanionFriends(companionId, { limit: 50 });
      setFriends(response.friends);
    } catch (err) {
      console.error('Failed to fetch friends:', err);
      setError(err instanceof Error ? err.message : 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  }, [companionId]);

  const handleInvite = useCallback(async (friend: CompanionFriendship) => {
    if (!onInviteFriend) return;

    setInvitingId(friend.friendCompanionId);
    try {
      await onInviteFriend(friend);
    } finally {
      setInvitingId(null);
    }
  }, [onInviteFriend]);

  const isAlreadyInChat = useCallback((friendId: string) => {
    return activeParticipantIds.includes(friendId);
  }, [activeParticipantIds]);

  // Validate companionId is a valid UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidCompanionId = companionId && uuidRegex.test(companionId);

  if (!isOpen) return null;

  if (!isValidCompanionId) {
    return (
      <div className="fixed bottom-4 right-4 w-[360px] z-50 shadow-2xl rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm">Friends</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Unable to load friends. Please refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-[360px] max-h-[450px] z-50 shadow-2xl rounded-lg border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-purple-500" />
          <span className="font-semibold text-sm">{companionName}&apos;s Friends</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-3">
        <ScrollArea className="h-[350px]">
          {/* Error */}
          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded mb-3">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500 mb-4" />
              <p className="text-sm text-muted-foreground">Loading friends...</p>
            </div>
          )}

          {/* No friends */}
          {!loading && !error && friends.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Users className="h-8 w-8 mb-3 opacity-50" />
              <p className="text-sm font-medium">No friends yet</p>
              <p className="text-xs mt-1 max-w-[240px]">
                Add friends to {companionName} from the companion settings page to invite them to chats.
              </p>
            </div>
          )}

          {/* Friends list */}
          {!loading && !error && friends.length > 0 && (
            <div className="space-y-2 pr-2">
              {friends.map((friend) => {
                const friendInfo = friend.friendCompanion;
                const inChat = isAlreadyInChat(friend.friendCompanionId);

                return (
                  <div
                    key={friend.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={friendInfo?.avatarUrl || undefined}
                        alt={friendInfo?.name || 'Friend'}
                      />
                      <AvatarFallback className="bg-purple-500 text-white">
                        {(friendInfo?.name || '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {friend.nickname || friendInfo?.name || 'Unknown'}
                      </p>
                      {friend.relationshipType && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Heart className="h-3 w-3 text-pink-500" />
                          <span className="capitalize">{friend.relationshipType.replace('_', ' ')}</span>
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant={inChat ? 'secondary' : 'default'}
                      className="gap-1.5"
                      disabled={inChat || invitingId === friend.friendCompanionId}
                      onClick={() => handleInvite(friend)}
                    >
                      {invitingId === friend.friendCompanionId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : inChat ? (
                        <>In Chat</>
                      ) : (
                        <>
                          <UserPlus className="h-3.5 w-3.5" />
                          Invite
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
