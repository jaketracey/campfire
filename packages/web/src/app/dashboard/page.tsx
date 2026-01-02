'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
import { MessageCircle, Plus, RotateCcw, Sparkles, Trash2, ArrowRight, Check, Users, Settings, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { ShareCompanionDialog } from '@/components/companion/share-companion-dialog';
import { BackstoryModal } from '@/components/companion/backstory-modal';
import { CompanionCardImage } from '@/components/companion/companion-card-image';
import { ContinueConversation } from '@/components/dashboard/continue-conversation';
import { useAuth } from '@/hooks/use-auth';
import { WelcomeTransition } from '@/components/auth/welcome-transition';
import {
  listCompanions,
  listSessions,
  deleteCompanion,
  getInviteCode,
  getPersonalityProfile,
  getRandomDefaultWelcome,
  buildPersonalizedWelcome,
} from '@/lib/api';
import type {
  Companion as APICompanion,
  Session as APISession,
  InviteCodeData,
  CompanionSpec,
  UserPersonalityProfile,
} from '@/lib/api';
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
  companionImageUrl: string | null; // Latest conversation image or anchor image
  lastMessage: string;
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, isInitialized, user, isLoading: authLoading } = useAuth();
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [companionToDelete, setCompanionToDelete] = useState<Companion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [inviteCode, setInviteCode] = useState<InviteCodeData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  // Backstory modal state
  const [backstoryCompanion, setBackstoryCompanion] = useState<Companion | null>(null);
  // Personality profile state for personalized welcome
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);

  // Mouse drag scroll for companion carousel
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Desktop slider state
  const desktopSliderRef = useRef<HTMLDivElement>(null);
  const [sliderIndex, setSliderIndex] = useState(0);
  const companionsPerSlide = 4;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeft(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 1.5; // Adjust scroll speed
    scrollContainerRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // Desktop slider navigation
  const maxSliderIndex = Math.max(0, Math.ceil(companions.length / companionsPerSlide) - 1);

  const handleSliderPrev = () => {
    setSliderIndex((prev) => Math.max(0, prev - 1));
  };

  const handleSliderNext = () => {
    setSliderIndex((prev) => Math.min(maxSliderIndex, prev + 1));
  };

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
    if (!isAuthenticated || !user?.id) return;

    setLoading(true);
    try {
      // Fetch companions, sessions, invite code, and personality profile in parallel
      const [companionsRes, sessionsRes, inviteCodeRes, personalityProfile] = await Promise.all([
        listCompanions({ limit: 50 }),
        listSessions({ limit: 20, status: 'active' }),
        getInviteCode().catch(() => null),
        getPersonalityProfile(user.id).catch(() => null),
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
        // Get best available image: latest conversation image > anchor image > avatar
        const ethnicity = companion?.spec?.visual_style?.appearance?.ethnicity || null;
        const anchorImage = ethnicity ? getAnchorImageUrl(ethnicity) : null;
        const companionImageUrl = companion?.latestConversationImageUrl || anchorImage || companion?.avatarUrl || null;
        return {
          id: s.id,
          companionId: s.companionId,
          companionName: companion?.name || 'Unknown Companion',
          companionAvatarUrl: companion?.avatarUrl || null,
          companionImageUrl,
          lastMessage: s.summary || 'Start chatting...',
          updatedAt: s.lastMessageAt || s.startedAt,
        };
      });

      setCompanions(mappedCompanions);
      setSessions(mappedSessions);

      // Generate personalized welcome message
      const userName = user.email?.split('@')[0] || 'friend';
      if (personalityProfile) {
        // Get the most recent companion for companion-aware message
        const recentCompanion = mappedSessions[0]?.companionName;
        const welcome = buildPersonalizedWelcome(userName, personalityProfile, recentCompanion);
        setWelcomeMessage(welcome);
      } else {
        // No profile yet - use random default message
        setWelcomeMessage(getRandomDefaultWelcome(userName));
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id, user?.email]);

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
    <WelcomeTransition>
    <div className="container max-w-7xl mx-auto py-12 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-12"
      >
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-5xl md:text-6xl font-bold font-display tracking-tight text-white">
              Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-campfire-400 via-campfire-500 to-campfire-600">Sanctuary</span>
            </h1>
            <p className="text-gray-400 text-lg max-w-xl">
              {welcomeMessage || (user?.email
                ? `Welcome back, ${user.email.split('@')[0]}. Your companions are waiting.`
                : 'Manage your digital sanctuary and companions.')}
            </p>
          </div>
          <div className="flex flex-col lg:flex-row gap-3 md:pt-6">
            <motion.button
              onClick={() => router.push('/onboard')}
              className="h-14 md:h-11 px-8 md:px-6 rounded-full bg-campfire-600 hover:bg-campfire-500 text-white font-bold text-lg md:text-base shadow-[0_0_20px_rgba(234,88,12,0.3)] transition-colors"
              whileHover={{
                scale: 1.05,
                boxShadow: '0 0 30px rgba(234,88,12,0.5)'
              }}
              whileTap={{ scale: 0.95 }}
            >
              Design new companion
            </motion.button>
            {inviteCode && (
              <motion.button
                onClick={handleCopyCode}
                className="relative h-14 md:h-11 px-8 md:px-6 rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-black font-bold text-lg md:text-base shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all hover:scale-105 active:scale-95 overflow-hidden flex items-center justify-center"
                whileHover={{ boxShadow: '0 0 30px rgba(245,158,11,0.5)' }}
              >
                {/* Shimmer overlay */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -skew-x-12"
                  animate={{
                    x: ['-100%', '200%'],
                  }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    repeatDelay: 3,
                    ease: 'easeInOut',
                  }}
                />
                {copiedCode ? (
                  <>
                    <Check className="mr-2 h-6 w-6 md:h-5 md:w-5 relative z-10" />
                    <span className="relative z-10">Copied!</span>
                  </>
                ) : (
                  <>
                    <Users className="mr-2 h-6 w-6 md:h-5 md:w-5 relative z-10" />
                    <span className="relative z-10">Invite friends</span>
                  </>
                )}
              </motion.button>
            )}
          </div>
        </div>

        {/* Admin Panel Link */}
        {user?.role === 'admin' && (
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

        {/* Continue Where You Left Off - shown only when there are recent sessions */}
        {hasSessions && (
          <ContinueConversation sessions={sessions} maxSessions={3} />
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
            {/* Mobile: horizontal scroll with mouse drag support, Desktop: grid */}
            <div
              ref={scrollContainerRef}
              className={`md:hidden -mx-4 px-4 pb-4 overflow-x-auto scrollbar-hide ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <div className="flex gap-4" style={{ width: 'max-content' }}>
                {companions.map((companion, idx) => {
                  const hasExistingSession = !!companion.latestSessionId;
                  const anchorImageUrl = getAnchorImageUrl(companion.ethnicity);
                  const displayImageUrl = companion.latestConversationImageUrl || anchorImageUrl || companion.avatarUrl;
                  const hasBackstory = !!companion.backstory;

                  return (
                    <motion.div
                      key={companion.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="w-[75vw] flex-shrink-0"
                    >
                      <Card className="group relative overflow-hidden bg-white/[0.01] backdrop-blur-3xl border border-white/5 hover:border-white/20 transition-all duration-500 shadow-2xl h-full">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
                        <CardContent className="p-0">
                          <div className="aspect-[2/3] relative overflow-hidden">
                            <CompanionCardImage
                              images={[
                                companion.latestConversationImageUrl,
                                companion.avatarUrl,
                              ]}
                              fallbackImage={anchorImageUrl}
                              alt={companion.name}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

                            {hasBackstory && (
                              <button
                                onClick={() => setBackstoryCompanion(companion)}
                                className="absolute top-3 right-3 p-2 rounded-xl bg-amber-900/60 border border-amber-600/30 text-amber-400 shadow-lg backdrop-blur-sm z-10"
                                title="View Backstory"
                              >
                                <BookOpen className="h-4 w-4" />
                              </button>
                            )}

                            {/* Companion name - hidden on hover */}
                            <div className="absolute bottom-4 left-4 right-4 z-10 group-hover:opacity-0 transition-opacity duration-200">
                              <h3 className="text-xl font-bold text-white truncate">{companion.name}</h3>
                              <p className="text-white/60 text-sm truncate">
                                {hasExistingSession ? 'Journey in progress' : 'Awaiting first encounter'}
                              </p>
                            </div>

                            {/* Hover action buttons */}
                            <div className="absolute bottom-4 left-4 right-4 z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                              <div className="flex gap-2">
                                {hasExistingSession ? (
                                  <>
                                    <Button
                                      onClick={() => handleResumeChat(companion.latestSessionId!)}
                                      className="flex-1 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-sm"
                                    >
                                      <RotateCcw className="h-4 w-4 mr-2" />
                                      Resume
                                    </Button>
                                    <Button
                                      onClick={() => handleNewChat(companion.id)}
                                      className="h-10 w-10 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white"
                                    >
                                      <Plus className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    onClick={() => handleNewChat(companion.id)}
                                    className="flex-1 h-10 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white"
                                  >
                                    <MessageCircle className="h-4 w-4 mr-2" />
                                    Start
                                  </Button>
                                )}
                                <ShareCompanionDialog
                                  companionId={companion.id}
                                  companionName={companion.name}
                                  isPublic={companion.isPublic}
                                  size="sm"
                                  referralCode={inviteCode?.code}
                                  onShareStatusChange={(isPublic) => {
                                    setCompanions((prev) =>
                                      prev.map((c) =>
                                        c.id === companion.id ? { ...c, isPublic } : c
                                      )
                                    );
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Desktop slider */}
            <div className="hidden md:block relative">
              {/* Navigation arrows */}
              {companions.length > companionsPerSlide && (
                <>
                  <button
                    onClick={handleSliderPrev}
                    disabled={sliderIndex === 0}
                    className="absolute -left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/60 border border-white/10 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/80 hover:border-white/20 transition-all backdrop-blur-sm shadow-lg"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    onClick={handleSliderNext}
                    disabled={sliderIndex >= maxSliderIndex}
                    className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/60 border border-white/10 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/80 hover:border-white/20 transition-all backdrop-blur-sm shadow-lg"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}

              {/* Slider container */}
              <div className="overflow-hidden" ref={desktopSliderRef}>
                <motion.div
                  className="flex gap-6"
                  animate={{ x: `-${sliderIndex * 100}%` }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  {companions.map((companion, idx) => {
                    const hasExistingSession = !!companion.latestSessionId;
                    const anchorImageUrl = getAnchorImageUrl(companion.ethnicity);
                    const hasBackstory = !!companion.backstory;

                    return (
                      <motion.div
                        key={companion.id}
                        className="w-[calc(25%-18px)] flex-shrink-0"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                      >
                        <Card className="group relative overflow-hidden bg-white/[0.01] backdrop-blur-3xl border border-white/5 hover:border-white/20 transition-all duration-500 shadow-2xl">
                          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
                          <CardContent className="p-0">
                            <div className="aspect-[2/3] relative overflow-hidden">
                              <CompanionCardImage
                                images={[
                                  companion.latestConversationImageUrl,
                                  companion.avatarUrl,
                                ]}
                                fallbackImage={anchorImageUrl}
                                alt={companion.name}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />

                              {/* Top right action buttons - visible on hover */}
                              <div className="absolute top-3 right-3 flex gap-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                {hasBackstory && (
                                  <button
                                    onClick={() => setBackstoryCompanion(companion)}
                                    className="p-2.5 rounded-xl bg-amber-900/60 hover:bg-amber-800/80 border border-amber-600/30 text-amber-400 hover:text-amber-300 transition-all shadow-lg backdrop-blur-sm"
                                    title="View Backstory"
                                  >
                                    <BookOpen className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setCompanionToDelete(companion)}
                                  className="p-2.5 rounded-xl bg-white/10 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 hover:text-red-400 transition-all shadow-lg backdrop-blur-sm"
                                  title="Delete Companion"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>

                              {/* Companion name - hidden on hover */}
                              <div className="absolute bottom-4 left-4 right-4 z-10 group-hover:opacity-0 transition-opacity duration-200">
                                <h3 className="font-bold text-xl text-white font-display leading-none mb-2">{companion.name}</h3>
                                <p className="text-xs text-white/60 font-medium tracking-wide">
                                  {hasExistingSession
                                    ? companion.latestConversationImageUrl
                                      ? 'Memory captured • Ready to continue'
                                      : 'Journey in progress'
                                    : 'Awaiting first encounter'}
                                </p>
                              </div>

                              {/* Hover action buttons */}
                              <div className="absolute bottom-4 left-4 right-4 z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                                <div className="flex gap-2">
                                  {hasExistingSession ? (
                                    <>
                                      <Button
                                        className="flex-1 h-12 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold border border-white/20 backdrop-blur-sm transition-all"
                                        onClick={() => handleResumeChat(companion.latestSessionId!)}
                                      >
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Resume
                                      </Button>
                                      <Button
                                        className="h-12 w-12 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white shadow-lg transition-all"
                                        onClick={() => handleNewChat(companion.id)}
                                      >
                                        <Plus className="h-5 w-5" />
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      className="flex-1 h-12 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white font-bold shadow-lg transition-all"
                                      onClick={() => handleNewChat(companion.id)}
                                    >
                                      <MessageCircle className="mr-2 h-5 w-5" />
                                      Start Journey
                                    </Button>
                                  )}
                                  <ShareCompanionDialog
                                    companionId={companion.id}
                                    companionName={companion.name}
                                    isPublic={companion.isPublic}
                                    size="sm"
                                    referralCode={inviteCode?.code}
                                    onShareStatusChange={(isPublic) => {
                                      setCompanions((prev) =>
                                        prev.map((c) =>
                                          c.id === companion.id ? { ...c, isPublic } : c
                                        )
                                      );
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </div>

              {/* Slider dots */}
              {companions.length > companionsPerSlide && (
                <div className="flex justify-center gap-2 mt-6">
                  {Array.from({ length: maxSliderIndex + 1 }).map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSliderIndex(idx)}
                      className={`h-2 rounded-full transition-all ${
                        idx === sliderIndex
                          ? 'w-8 bg-campfire-500'
                          : 'w-2 bg-white/20 hover:bg-white/40'
                      }`}
                    />
                  ))}
                </div>
              )}
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
    </WelcomeTransition>
  );
}
