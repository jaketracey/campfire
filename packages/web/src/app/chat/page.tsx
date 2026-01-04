'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { MessageCircle, Plus, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { listSessions, listCompanions } from '@/lib/api';
import type { Session as APISession, Companion as APICompanion } from '@/lib/api';
import { SessionSearch } from '@/components/chat/session-search';
import { useOnboardingStore } from '@/stores/onboarding-store';

/**
 * Session with enriched companion data for display
 */
interface SessionWithCompanion {
  id: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  lastMessage: string;
  status: 'active' | 'ended';
  turnCount: number;
  lastMessageAt: string | null;
  startedAt: string;
}

/**
 * Format a date as a relative time string (e.g., "2 hours ago")
 */
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'No messages yet';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSeconds < 60) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else if (diffWeeks < 4) {
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  } else {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  }
}

/**
 * Loading skeleton for session cards
 */
function SessionCardSkeleton() {
  return (
    <Card className="bg-white/[0.01] border border-white/5 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-5 w-32 bg-white/5 rounded animate-pulse" />
            <div className="h-4 w-full bg-white/5 rounded animate-pulse" />
          </div>
          <div className="h-4 w-16 bg-white/5 rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Session card component
 */
function SessionCard({
  session,
  onClick,
  index,
}: {
  session: SessionWithCompanion;
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        className="cursor-pointer bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all group overflow-hidden"
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {/* Companion Avatar */}
            <Avatar className="h-14 w-14 border border-white/10 flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
              {session.companionAvatarUrl ? (
                <AvatarImage
                  src={session.companionAvatarUrl}
                  alt={session.companionName}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-campfire-500/20 text-campfire-500">
                {session.companionName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            {/* Session Info */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-white font-display truncate">
                  {session.companionName}
                </h3>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {formatRelativeTime(session.lastMessageAt)}
                </span>
              </div>
              <p className="text-sm text-gray-400 line-clamp-2 group-hover:text-white/70 transition-colors">
                {session.lastMessage}
              </p>
              {session.turnCount > 0 && (
                <p className="text-xs text-gray-500">
                  {session.turnCount} message{session.turnCount === 1 ? '' : 's'}
                </p>
              )}
            </div>

            {/* Arrow indicator */}
            <div className="p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowRight className="h-5 w-5 text-campfire-500" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * Empty state component
 */
function EmptyState({ onCreateCompanion }: { onCreateCompanion: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.1 }}
    >
      <Card className="bg-white/[0.01] backdrop-blur-xl border border-white/10 overflow-hidden">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-20 w-20 rounded-full bg-campfire-500/10 border border-campfire-500/20 flex items-center justify-center mb-6">
            <MessageCircle className="h-10 w-10 text-campfire-500" />
          </div>
          <h2 className="text-2xl font-bold font-display text-white mb-2">
            No conversations yet
          </h2>
          <p className="text-gray-400 mb-8 max-w-md">
            Start chatting with your AI companions. Your conversation history will appear here.
          </p>
          <Button
            onClick={onCreateCompanion}
            className="h-12 px-8 rounded-full bg-campfire-600 hover:bg-campfire-500 text-white font-bold shadow-[0_0_20px_rgba(234,88,12,0.3)] transition-all hover:scale-105"
          >
            <Plus className="mr-2 h-5 w-5" />
            Create Companion
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * Error state component
 */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Card className="bg-red-500/5 border border-red-500/20 overflow-hidden">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Failed to load conversations</h2>
          <p className="text-gray-400 mb-6">{message}</p>
          <Button
            onClick={onRetry}
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * Chat Sessions List Page
 * Displays all user's conversation sessions with their companions.
 */
export default function ChatPage() {
  const router = useRouter();
  const resetOnboarding = useOnboardingStore((state) => state.reset);
  const { isAuthenticated, isInitialized, isLoading: authLoading, user } = useAuth();

  const [sessions, setSessions] = useState<SessionWithCompanion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (isInitialized && !authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isInitialized, authLoading, isAuthenticated, router]);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated || !user?.id) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch sessions and companions in parallel
      const [sessionsRes, companionsRes] = await Promise.all([
        listSessions({ limit: 50 }),
        listCompanions({ limit: 100 }),
      ]);

      // Create companion lookup map
      const companionMap = new Map<string, APICompanion>(
        companionsRes.companions.map((c) => [c.id, c])
      );

      // Enrich sessions with companion data
      const enrichedSessions: SessionWithCompanion[] = sessionsRes.sessions.map(
        (session: APISession) => {
          const companion = companionMap.get(session.companionId);
          return {
            id: session.id,
            companionId: session.companionId,
            companionName: companion?.name || 'Unknown Companion',
            companionAvatarUrl: companion?.avatarUrl || null,
            lastMessage: session.summary || 'Start chatting...',
            status: session.status,
            turnCount: session.turnCount,
            lastMessageAt: session.lastMessageAt,
            startedAt: session.startedAt,
          };
        }
      );

      // Sort by most recent activity first
      enrichedSessions.sort((a, b) => {
        const dateA = new Date(a.lastMessageAt || a.startedAt);
        const dateB = new Date(b.lastMessageAt || b.startedAt);
        return dateB.getTime() - dateA.getTime();
      });

      setSessions(enrichedSessions);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  // Fetch data when authenticated
  useEffect(() => {
    if (isInitialized && isAuthenticated) {
      fetchData();
    }
  }, [isInitialized, isAuthenticated, fetchData]);

  const handleSessionClick = (sessionId: string) => {
    router.push(`/chat/${sessionId}`);
  };

  const handleCreateCompanion = () => {
    resetOnboarding();
    router.push('/onboard');
  };

  // Show loading while checking auth or loading data
  if (!isInitialized || authLoading || loading) {
    return (
      <div className="container max-w-4xl mx-auto py-12 px-6">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <div className="h-10 w-48 bg-white/5 rounded animate-pulse" />
            <div className="h-5 w-64 bg-white/5 rounded animate-pulse" />
          </div>
          <div className="h-11 w-40 bg-white/5 rounded-full animate-pulse" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <SessionCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="container max-w-4xl mx-auto py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-4xl font-bold font-display text-white">
              Conversations
            </h1>
            <p className="text-gray-400">
              {sessions.length > 0
                ? `${sessions.length} conversation${sessions.length === 1 ? '' : 's'}`
                : 'Your chat history with companions'}
            </p>
          </div>
          <Button
            onClick={handleCreateCompanion}
            className="h-11 px-6 rounded-full bg-campfire-600 hover:bg-campfire-500 text-white font-bold shadow-[0_0_15px_rgba(234,88,12,0.3)] transition-all hover:scale-105"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Companion
          </Button>
        </div>

        {/* Search */}
        <SessionSearch className="w-full" />

        {/* Error State */}
        {error && <ErrorState message={error} onRetry={fetchData} />}

        {/* Sessions List or Empty State */}
        {!error && (
          <>
            {sessions.length === 0 ? (
              <EmptyState onCreateCompanion={handleCreateCompanion} />
            ) : (
              <div className="space-y-3">
                {sessions.map((session, index) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onClick={() => handleSessionClick(session.id)}
                    index={index}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </motion.div>

    </div>
  );
}
