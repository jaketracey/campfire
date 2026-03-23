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
import { MessageCircle, Plus, RotateCcw, Trash2, Settings, BookOpen } from 'lucide-react';
import { BackstoryModal } from '@/components/companion/backstory-modal';
import { CompanionCardImage } from '@/components/companion/companion-card-image';
import { useAuth } from '@/hooks/use-auth';
import { WelcomeTransition } from '@/components/auth/welcome-transition';
import {
  listCompanions,
  browseCompanions,
  deleteCompanion,
} from '@/lib/api';
import type {
  Companion as APICompanion,
} from '@/lib/api';
import type { ImageRenditions } from '@/lib/utils/image-renditions';
import Link from 'next/link';
import type { Route } from 'next';

interface Companion {
  id: string;
  name: string;
  archetype: string;
  avatarUrl: string | null;
  avatarRenditions?: ImageRenditions | null;
  createdAt: string;
  isPublic: boolean;
  latestSessionId: string | null;
  latestConversationImageUrl: string | null;
  // New fields for anchor image and backstory
  ethnicity: string | null;
  backstory: string | null;
}

// Anchor images are no longer used - companions use latestConversationImageUrl or avatarUrl
function getAnchorImageUrl(_ethnicity: string | null): string | null {
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, isInitialized, user, isLoading: authLoading } = useAuth();
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(true);
  const [companionToDelete, setCompanionToDelete] = useState<Companion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Backstory modal state
  const [backstoryCompanion, setBackstoryCompanion] = useState<Companion | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let companionsRes;
      if (isAuthenticated && user?.id) {
        // Authenticated: fetch user's companions
        companionsRes = await listCompanions({ limit: 200 });
      } else {
        // Unauthenticated: browse all companions
        companionsRes = await browseCompanions({ limit: 200 });
      }

      // Map API companions to dashboard format
      const mappedCompanions: Companion[] = companionsRes.companions.map((c: APICompanion) => ({
        id: c.id,
        name: c.name,
        archetype: c.spec?.personality?.archetype || c.description || 'Custom',
        avatarUrl: c.avatarUrl,
        avatarRenditions: c.avatarRenditions || null,
        createdAt: c.createdAt,
        isPublic: c.isPublic,
        latestSessionId: c.latestSessionId || null,
        latestConversationImageUrl: c.latestConversationImageUrl || null,
        // Extract ethnicity and backstory from spec
        ethnicity: c.spec?.visual_style?.appearance?.ethnicity || null,
        backstory: c.spec?.identity?.backstory || null,
      }));

      setCompanions(mappedCompanions);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  const firstName = isAuthenticated
    ? (
      user?.displayName?.trim().split(/\s+/).filter(Boolean)[0]
      ?? user?.email?.split('@')[0]
      ?? 'there'
    )
    : '';

  useEffect(() => {
    if (isInitialized && !authLoading) {
      fetchData();
    }
  }, [isInitialized, authLoading, fetchData]);

  const handleNewChat = (companion: Companion) => {
    if (!isAuthenticated) {
      const queryParams = new URLSearchParams();
      queryParams.set('companionId', companion.id);
      queryParams.set('companionName', companion.name);
      if (companion.avatarUrl) {
        queryParams.set('companionAvatarUrl', companion.avatarUrl);
      }
      if (companion.archetype) {
        queryParams.set('companionArchetype', companion.archetype);
      }
      if (companion.backstory) {
        queryParams.set('companionDescription', companion.backstory);
      }

      router.push(`/chat/demo?${queryParams.toString()}`);
      return;
    }
    router.push(`/chat/new?companion=${companion.id}`);
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
    } catch (error) {
      console.error('Failed to delete companion:', error);
    } finally {
      setIsDeleting(false);
      setCompanionToDelete(null);
    }
  };

  // Show skeleton while checking auth or loading data
  if (!isInitialized || authLoading || loading) {
    return (
      <div className="w-full py-12 px-4 sm:px-6">
        <div className="space-y-8">
          <div className="text-center space-y-3">
            <div className="h-8 w-48 bg-white/[0.05] rounded-lg mx-auto animate-pulse" />
            <div className="h-4 w-64 bg-white/[0.03] rounded mx-auto animate-pulse" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const hasCompanions = companions.length > 0;

  return (
    <WelcomeTransition>
    <div className="w-full py-12 px-4 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        {/* Admin Panel Link */}
        {isAuthenticated && user?.role === 'admin' && (
          <div className="flex justify-end">
            <Link
              href={'/admin' as Route}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-campfire-500/10 border border-campfire-500/20 text-campfire-500 text-sm font-medium hover:bg-campfire-500/20 transition-colors"
            >
              <Settings className="h-4 w-4" />
              Admin Panel
            </Link>
          </div>
        )}

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
                <div className="space-y-4">
                  <h2 className="text-3xl font-bold font-display text-white">Ready to ignite?</h2>
                  <p className="text-gray-400 text-lg max-w-md mx-auto">
                    Every spark starts somewhere. Design your first companion and see where the conversation takes you.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    if (!isAuthenticated) {
                      router.push('/login');
                      return;
                    }
                    router.push('/onboard');
                  }}
                  size="xl"
                  className="h-16 px-12 rounded-full bg-gradient-to-r from-campfire-500 to-campfire-600 text-white font-bold text-xl shadow-[0_0_30px_rgba(249,115,22,0.3)] hover:scale-105 transition-all"
                >
                  Design new companion
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Companions Grid - dense mosaic of small thumbnails */}
        {hasCompanions && (
          <section className={isAuthenticated ? 'space-y-4' : ''}>
            {isAuthenticated && (
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold font-display text-white leading-tight">
                Welcome back, {firstName}
              </h2>
            )}

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2">
              {companions.map((companion, idx) => {
                const hasExistingSession = isAuthenticated && !!companion.latestSessionId;
                const anchorImageUrl = getAnchorImageUrl(companion.ethnicity);
                const hasBackstory = !!companion.backstory;

                return (
                  <motion.div
                    key={companion.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(idx * 0.02, 1) }}
                  >
                    <Card className="group relative overflow-hidden bg-white/[0.01] border border-white/5 hover:border-white/30 transition-all duration-300 shadow-lg hover:shadow-xl hover:z-10 hover:scale-105">
                      <CardContent className="p-0">
                        <div className="aspect-[2/3] relative overflow-hidden">
                          <CompanionCardImage
                            images={[
                              companion.latestConversationImageUrl,
                              companion.avatarUrl,
                            ]}
                            avatarUrl={companion.avatarUrl}
                            avatarRenditions={companion.avatarRenditions}
                            fallbackImage={anchorImageUrl}
                            alt={companion.name}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />

                          {/* Companion name overlay */}
                          <div className="absolute bottom-0 left-0 right-0 p-1.5 z-10 group-hover:opacity-0 transition-opacity duration-200">
                            <h3 className="font-bold text-[10px] sm:text-xs text-white truncate leading-tight">{companion.name}</h3>
                          </div>

                          {/* Hover action overlay */}
                          <div className="absolute inset-0 z-20 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/60 flex flex-col items-center justify-center gap-1.5 p-1.5">
                            {/* Top right actions - only for authenticated users */}
                            {isAuthenticated && (
                              <div className="absolute top-1 right-1 flex gap-1">
                                {hasBackstory && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setBackstoryCompanion(companion); }}
                                    className="p-1 rounded-md bg-amber-900/60 border border-amber-600/30 text-amber-400 backdrop-blur-sm"
                                    title="View Backstory"
                                  >
                                    <BookOpen className="h-3 w-3" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCompanionToDelete(companion); }}
                                  className="p-1 rounded-md bg-white/10 hover:bg-red-500/20 border border-white/10 text-white/70 hover:text-red-400 backdrop-blur-sm"
                                  title="Delete Companion"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}

                            <h3 className="font-bold text-[10px] sm:text-xs text-white text-center truncate w-full px-1">{companion.name}</h3>

                            {hasExistingSession ? (
                              <div className="flex flex-col gap-1 w-full px-1">
                                <Button
                                  onClick={() => handleResumeChat(companion.latestSessionId!)}
                                  className="w-full h-6 rounded-md bg-white/10 hover:bg-white/20 text-white text-[10px] border border-white/20 backdrop-blur-sm px-1"
                                >
                                  <RotateCcw className="h-2.5 w-2.5 mr-1 flex-shrink-0" />
                                  Resume
                                </Button>
                                <Button
                                  onClick={() => handleNewChat(companion)}
                                  className="w-full h-6 rounded-md bg-campfire-600 hover:bg-campfire-500 text-white text-[10px] px-1"
                                >
                                  <Plus className="h-2.5 w-2.5 mr-1 flex-shrink-0" />
                                  New
                                </Button>
                              </div>
                            ) : (
                              <Button
                                onClick={() => handleNewChat(companion)}
                                className="w-full h-6 rounded-md bg-campfire-600 hover:bg-campfire-500 text-white text-[10px] mx-1 px-1"
                              >
                                <MessageCircle className="h-2.5 w-2.5 mr-1 flex-shrink-0" />
                                {isAuthenticated ? 'Start' : 'Chat'}
                              </Button>
                            )}
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

      </motion.div>

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
    </WelcomeTransition>
  );
}
