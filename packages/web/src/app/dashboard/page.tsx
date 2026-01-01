'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { motion } from 'framer-motion';
import { LogOut, MessageCircle, Plus, RotateCcw, Sparkles, Trash2, ArrowRight, Copy, Check, Users, Link as LinkIcon, Settings, Share2, BookOpen } from 'lucide-react';
import { ShareCompanionDialog } from '@/components/companion/share-companion-dialog';
import { BackstoryModal } from '@/components/companion/backstory-modal';
import { useAuth } from '@/hooks/use-auth';
import { listCompanions, listSessions, deleteCompanion, getInviteCode } from '@/lib/api';
import type { Companion as APICompanion, Session as APISession, InviteCodeData, CompanionSpec } from '@/lib/api';
import Link from 'next/link';
import type { Route } from 'next';

interface Companion {
  id: string;
  name: string;
  archetype: string;
  avatarUrl: string | null;
  createdAt: string;
  isPublic: boolean;
  latestSessionId: string | null;
  latestConversationImageUrl: string | null;
  // New fields for anchor image and backstory
  ethnicity: string | null;
  backstory: string | null;
}

// Get anchor image path based on ethnicity
function getAnchorImageUrl(ethnicity: string | null): string | null {
  if (!ethnicity) return null;
  const validEthnicities = ['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed'];
  if (validEthnicities.includes(ethnicity)) {
    return `/images/companions/anchors/${ethnicity}.png`;
  }
  return null;
}

interface Session {
  id: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  lastMessage: string;
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, isInitialized, user, logout, isLoading: authLoading } = useAuth();
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [companionToDelete, setCompanionToDelete] = useState<Companion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [inviteCode, setInviteCode] = useState<InviteCodeData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  // Backstory modal state
  const [backstoryCompanion, setBackstoryCompanion] = useState<Companion | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    console.log('[DASHBOARD] Auth check:', {
      isInitialized,
      authLoading,
      isAuthenticated,
      userId: user?.id,
    });
    if (isInitialized && !authLoading && !isAuthenticated) {
      console.log('[DASHBOARD] Redirecting to /login - not authenticated');
      router.push('/login');
    }
  }, [isInitialized, authLoading, isAuthenticated, router]);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    try {
      // Fetch companions, sessions, and invite code in parallel
      const [companionsRes, sessionsRes, inviteCodeRes] = await Promise.all([
        listCompanions({ limit: 50 }),
        listSessions({ limit: 20, status: 'active' }),
        getInviteCode().catch(() => null),
      ]);

      // Set invite code if fetched successfully
      if (inviteCodeRes?.data) {
        setInviteCode(inviteCodeRes.data);
      }

      // Map API companions to dashboard format
      const mappedCompanions: Companion[] = companionsRes.companions.map((c: APICompanion) => ({
        id: c.id,
        name: c.name,
        archetype: c.spec?.personality?.archetype || c.description || 'Custom',
        avatarUrl: c.avatarUrl,
        createdAt: c.createdAt,
        isPublic: c.isPublic,
        latestSessionId: c.latestSessionId || null,
        latestConversationImageUrl: c.latestConversationImageUrl || null,
        // Extract ethnicity and backstory from spec
        ethnicity: c.spec?.visual_style?.appearance?.ethnicity || null,
        backstory: c.spec?.identity?.backstory || null,
      }));

      // Create lookup maps for companion names and avatars
      const companionMap = new Map(companionsRes.companions.map((c: APICompanion) => [c.id, c]));

      // Map API sessions to dashboard format
      const mappedSessions: Session[] = sessionsRes.sessions.map((s: APISession) => {
        const companion = companionMap.get(s.companionId);
        return {
          id: s.id,
          companionId: s.companionId,
          companionName: companion?.name || 'Unknown Companion',
          companionAvatarUrl: companion?.avatarUrl || null,
          lastMessage: s.summary || 'Start chatting...',
          updatedAt: s.lastMessageAt || s.startedAt,
        };
      });

      setCompanions(mappedCompanions);
      setSessions(mappedSessions);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isInitialized && isAuthenticated) {
      fetchData();
    }
  }, [isInitialized, isAuthenticated, fetchData]);

  const handleNewChat = (companionId: string) => {
    router.push(`/chat/new?companion=${companionId}`);
  };

  const handleResumeChat = (sessionId: string) => {
    router.push(`/chat/${sessionId}`);
  };

  const handleDeleteCompanion = async () => {
    if (!companionToDelete) return;

    setIsDeleting(true);
    try {
      await deleteCompanion(companionToDelete.id);
      // Remove from local state
      setCompanions((prev) => prev.filter((c) => c.id !== companionToDelete.id));
      // Also remove related sessions
      setSessions((prev) => prev.filter((s) => s.companionId !== companionToDelete.id));
    } catch (error) {
      console.error('Failed to delete companion:', error);
    } finally {
      setIsDeleting(false);
      setCompanionToDelete(null);
    }
  };

  const handleCopyCode = async () => {
    if (!inviteCode?.code) return;
    await navigator.clipboard.writeText(inviteCode.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyUrl = async () => {
    if (!inviteCode?.inviteUrl) return;
    await navigator.clipboard.writeText(inviteCode.inviteUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Show loading while checking auth or loading data
  if (!isInitialized || authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  const hasCompanions = companions.length > 0;
  const hasSessions = sessions.length > 0;

  return (
    <div className="container max-w-7xl mx-auto py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-12"
      >
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-5xl md:text-6xl font-bold font-display tracking-tight text-white">
              Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-campfire-400 via-campfire-500 to-campfire-600">Sanctuary</span>
            </h1>
            <p className="text-gray-400 text-lg max-w-xl">
              {user?.email
                ? `Welcome back, ${user.email.split('@')[0]}. Your companions are waiting.`
                : 'Manage your digital sanctuary and companions.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              onClick={() => router.push('/onboard')}
              size="lg"
              className="h-14 px-8 rounded-full bg-campfire-600 hover:bg-campfire-500 text-white font-bold text-lg shadow-[0_0_20px_rgba(234,88,12,0.3)] transition-all hover:scale-105 active:scale-95"
            >
              <Plus className="mr-2 h-6 w-6" />
              Build New
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={logout}
              className="h-14 px-8 rounded-full border-white/5 bg-white/[0.02] hover:bg-white/[0.05] text-gray-300 font-bold transition-all hover:scale-105"
            >
              <LogOut className="mr-2 h-5 w-5" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Status Dashboard - Optional futuristic metric bar if we had stats */}

        {/* Empty State */}
        {!hasCompanions && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="bg-white/[0.01] backdrop-blur-3xl border border-white/10 overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-campfire-500/5 via-transparent to-campfire-500/5 pointer-events-none" />
              <CardContent className="flex flex-col items-center justify-center py-24 text-center space-y-8 relative z-10">
                <div className="h-24 w-24 rounded-3xl bg-campfire-500/10 border border-campfire-500/20 flex items-center justify-center shadow-[0_0_50px_rgba(249,115,22,0.15)]">
                  <Sparkles className="h-12 w-12 text-campfire-500 animate-pulse" />
                </div>
                <div className="space-y-4">
                  <h2 className="text-3xl font-bold font-display text-white">The campfire is cold...</h2>
                  <p className="text-gray-400 text-lg max-w-md mx-auto">
                    Every great journey begins with a single spark. Create your first AI companion and bring your digital sanctuary to life.
                  </p>
                </div>
                <Button
                  onClick={() => router.push('/onboard')}
                  size="xl"
                  className="h-16 px-12 rounded-full bg-gradient-to-r from-campfire-500 to-campfire-600 text-white font-bold text-xl shadow-[0_0_30px_rgba(249,115,22,0.3)] hover:scale-105 transition-all"
                >
                  Invite a Companion
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Companions Section */}
        {hasCompanions && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold font-display text-white flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-campfire-500 animate-pulse" />
                Your Companions
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {companions.map((companion, idx) => {
                const hasExistingSession = !!companion.latestSessionId;
                // Priority: conversation image -> anchor image (by ethnicity) -> avatar -> gradient
                const anchorImageUrl = getAnchorImageUrl(companion.ethnicity);
                const displayImageUrl = companion.latestConversationImageUrl || anchorImageUrl || companion.avatarUrl;
                const hasBackstory = !!companion.backstory;

                return (
                  <motion.div
                    key={companion.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                  >
                    <Card
                      className="group relative overflow-hidden bg-white/[0.01] backdrop-blur-3xl border border-white/5 hover:border-white/20 transition-all duration-500 shadow-2xl"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
                      <CardContent className="p-0">
                        {/* Status Image Area - matches anchor image ratio (512x768 = 2:3) */}
                        <div className="aspect-[2/3] relative overflow-hidden">
                          {displayImageUrl ? (
                            <img
                              src={displayImageUrl}
                              alt={companion.name}
                              className="w-full h-full object-cover object-top group-hover:scale-110 transition-transform duration-1000"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-campfire-500/20 via-campfire-600/10 to-campfire-700/20" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                          {/* Backstory button - top right corner */}
                          {hasBackstory && (
                            <button
                              onClick={() => setBackstoryCompanion(companion)}
                              className="absolute top-3 right-3 p-2 rounded-xl bg-amber-900/60 hover:bg-amber-800/80 border border-amber-600/30 text-amber-400 hover:text-amber-300 transition-all opacity-0 group-hover:opacity-100 shadow-lg backdrop-blur-sm"
                              title="View Backstory"
                            >
                              <BookOpen className="h-4 w-4" />
                            </button>
                          )}

                          <div className="absolute bottom-4 left-4 right-4">
                            <h3 className="font-bold text-xl text-white font-display leading-none mb-2">{companion.name}</h3>
                            <p className="text-xs text-white/60 font-medium tracking-wide">
                              {hasExistingSession
                                ? companion.latestConversationImageUrl
                                  ? 'Memory captured • Ready to continue'
                                  : 'Journey in progress'
                                : 'Awaiting first encounter'}
                            </p>
                          </div>
                        </div>

                        {/* Actions Area */}
                        <div className="p-6 space-y-4">
                          <div className="flex gap-3">
                            {hasExistingSession ? (
                              <>
                                <Button
                                  className="flex-1 h-12 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold border border-white/10 transition-all"
                                  onClick={() => handleResumeChat(companion.latestSessionId!)}
                                >
                                  <RotateCcw className="mr-2 h-4 w-4" />
                                  Resume
                                </Button>
                                <Button
                                  className="aspect-square h-12 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white shadow-lg"
                                  onClick={() => handleNewChat(companion.id)}
                                >
                                  <Plus className="h-5 w-5" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                className="flex-1 h-14 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white font-bold text-lg shadow-lg"
                                onClick={() => handleNewChat(companion.id)}
                              >
                                <MessageCircle className="mr-2 h-5 w-5" />
                                Start Journey
                              </Button>
                            )}
                            {/* Backstory button in action bar */}
                            {hasBackstory && (
                              <Button
                                className="aspect-square h-12 md:h-14 rounded-xl bg-amber-900/20 border border-amber-700/30 hover:bg-amber-900/40 hover:border-amber-600/50 text-amber-500 hover:text-amber-400 transition-all"
                                onClick={() => setBackstoryCompanion(companion)}
                                title="View Backstory"
                              >
                                <BookOpen className="h-5 w-5" />
                              </Button>
                            )}
                            <ShareCompanionDialog
                              companionId={companion.id}
                              companionName={companion.name}
                              isPublic={companion.isPublic}
                              onShareStatusChange={(isPublic) => {
                                setCompanions((prev) =>
                                  prev.map((c) =>
                                    c.id === companion.id ? { ...c, isPublic } : c
                                  )
                                );
                              }}
                            />
                            <Button
                              className="aspect-square h-12 md:h-14 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-500 text-gray-500 transition-all"
                              onClick={() => setCompanionToDelete(companion)}
                            >
                              <Trash2 className="h-5 w-5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recent Conversations */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold font-display text-white flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-white/40" />
            Active Memories
          </h2>
          {!hasSessions ? (
            <Card className="bg-white/[0.01] border border-white/5 backdrop-blur-xl">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center">
                  <MessageCircle className="h-8 w-8 text-white/20" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold font-display text-white">No active echoes</h3>
                  <p className="text-gray-500 max-w-xs mx-auto text-sm">
                    Conversations you start with companions will appear here as persistent memories.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sessions.map((session, idx) => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card
                    className="cursor-pointer bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 transition-all group overflow-hidden"
                    onClick={() => handleResumeChat(session.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl overflow-hidden border border-white/10 flex-shrink-0 relative group-hover:scale-105 transition-transform duration-500">
                          {session.companionAvatarUrl ? (
                            <img
                              src={session.companionAvatarUrl}
                              alt={session.companionName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-white/5 flex items-center justify-center text-white/20">
                              <MessageCircle className="h-6 w-6" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between">
                            <h3 className="font-bold text-white font-display">{session.companionName}</h3>
                            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">
                              {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <p className="text-sm text-gray-400 line-clamp-2 leading-relaxed italic group-hover:text-white/80 transition-colors">
                            "{session.lastMessage}"
                          </p>
                        </div>
                        <div className="p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ArrowRight className="h-5 w-5 text-campfire-500" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Affiliate Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold font-display text-white flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-campfire-500/60" />
              Invite Friends
            </h2>
            {user?.role === 'admin' && (
              <Link
                href={'/admin' as Route}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-campfire-500/10 border border-campfire-500/20 text-campfire-500 text-sm font-medium hover:bg-campfire-500/20 transition-colors"
              >
                <Settings className="h-4 w-4" />
                Admin Panel
              </Link>
            )}
          </div>

          <Card className="bg-white/[0.01] border border-white/5 backdrop-blur-xl overflow-hidden">
            <CardContent className="p-6">
              {inviteCode ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Stats */}
                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                    <div className="h-12 w-12 rounded-xl bg-campfire-500/10 flex items-center justify-center">
                      <Users className="h-6 w-6 text-campfire-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white">{inviteCode.usesCount}</p>
                      <p className="text-sm text-gray-500">Friends Invited</p>
                    </div>
                  </div>

                  {/* Invite Code */}
                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Your Code</p>
                      <p className="text-lg font-mono font-bold text-white">{inviteCode.code}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyCode}
                      className="h-10 w-10 rounded-xl border-white/10 hover:bg-white/10"
                    >
                      {copiedCode ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {/* Invite URL */}
                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Share Link</p>
                      <p className="text-sm text-gray-400 truncate">{inviteCode.inviteUrl}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyUrl}
                      className="h-10 w-10 rounded-xl border-white/10 hover:bg-white/10"
                    >
                      {copiedUrl ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <LinkIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="h-12 w-12 rounded-xl bg-white/5 mx-auto flex items-center justify-center mb-4">
                    <Users className="h-6 w-6 text-white/20" />
                  </div>
                  <p className="text-gray-500">Your invite code will appear here</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </motion.div>

      {/* Styles for animation */}
      <style jsx global>{`
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!companionToDelete} onOpenChange={(open) => !open && setCompanionToDelete(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl p-8 backdrop-blur-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-3xl font-bold font-display text-white">Sever Connection?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400 text-lg py-4">
              Are you sure you want to delete <span className="text-white font-bold">{companionToDelete?.name}</span>?
              This will erase all shared history and memories forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-4">
            <AlertDialogCancel
              disabled={isDeleting}
              className="rounded-full h-14 border-white/5 bg-white/5 hover:bg-white/10 text-white font-bold"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCompanion}
              disabled={isDeleting}
              className="rounded-full h-14 bg-red-600 hover:bg-red-500 text-white font-bold px-8 shadow-[0_0_20px_rgba(220,38,38,0.2)] transition-all"
            >
              {isDeleting ? 'Erasing...' : 'Sever Connection'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Backstory Modal - Oblivion style reveal */}
      <BackstoryModal
        isOpen={!!backstoryCompanion}
        onClose={() => setBackstoryCompanion(null)}
        companionName={backstoryCompanion?.name || ''}
        backstory={backstoryCompanion?.backstory || ''}
        archetype={backstoryCompanion?.archetype}
        avatarUrl={
          backstoryCompanion
            ? getAnchorImageUrl(backstoryCompanion.ethnicity) || backstoryCompanion.avatarUrl || undefined
            : undefined
        }
      />
    </div>
  );
}
