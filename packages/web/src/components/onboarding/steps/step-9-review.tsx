'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Flame, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { createSession, streamAnchorImages, generateBackstory, type AnchorImage, type GenerateBackstoryResult } from '@/lib/api';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { trackOnboardingStep, trackOnboardingComplete } from '@/lib/analytics/meta-pixel';

type RevealPhase = 'loading' | 'images' | 'ready';

export function Step9Review() {
  const router = useRouter();
  const { toast } = useToast();
  const { isAuthenticated, isInitialized } = useAuth();
  const state = useOnboardingStore();
  const {
    companionId,
    sessionId: storedSessionId,
    setSessionId: storeSetSessionId,
    anchorImages: storeAnchorImages,
    anchorImagesComplete: storeAnchorImagesComplete,
    anchorStreamStarted,
    addAnchorImage,
    setAnchorImagesComplete,
    setAnchorStreamStarted,
  } = state;

  const [revealPhase, setRevealPhase] = useState<RevealPhase>('loading');
  // Use store images if available (from Surprise Me), otherwise local state
  const [localAnchors, setLocalAnchors] = useState<AnchorImage[]>([]);
  const generatedAnchors = storeAnchorImages.length > 0 ? storeAnchorImages : localAnchors;
  const [backstoryResult, setBackstoryResult] = useState<GenerateBackstoryResult | null>(null);
  const [localImagesGenerated, setLocalImagesGenerated] = useState(false);
  const imagesGenerated = storeAnchorImagesComplete || localImagesGenerated;
  const [localSessionId, setLocalSessionId] = useState<string | null>(storedSessionId);
  const [visibleImageCount, setVisibleImageCount] = useState(0);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isNavigatingToChat, setIsNavigatingToChat] = useState(false);
  const hasConnectedRef = useRef(false);
  const hasTrackedRef = useRef(false);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const isCreatingSessionRef = useRef(false);
  const igniteNavigationTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Track step on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      trackOnboardingStep(6, 'review', 'full');
      hasTrackedRef.current = true;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
        setAnchorStreamStarted(false);
      }
      if (igniteNavigationTimeoutRef.current) {
        window.clearTimeout(igniteNavigationTimeoutRef.current);
        igniteNavigationTimeoutRef.current = null;
      }
    };
  }, [setAnchorStreamStarted]);

  // Auto-connect to generation stream on mount.
  // If a stream is already in-flight from an earlier step, do not start another one.
  useEffect(() => {
    if (!companionId || hasConnectedRef.current) return;
    hasConnectedRef.current = true;

    const shouldStartStream = storeAnchorImages.length === 0 && !storeAnchorImagesComplete && !anchorStreamStarted;

    if (shouldStartStream) {
      // Connect to anchor image stream
      console.log('[Review] Starting anchor image stream');
      setAnchorStreamStarted(true);
      streamCleanupRef.current = streamAnchorImages(
        {
          companionId: companionId,
          appearance: state.visualStyle.appearance,
          personality: {
            warmth: state.personality.warmth,
            playfulness: state.personality.playfulness,
            directness: state.personality.directness,
            curiosity: state.personality.curiosity,
            empathy: state.personality.empathy,
            assertiveness: state.personality.assertiveness,
          },
        },
        {
          onProgress: (data) => {
            console.log('Anchor progress:', data);
          },
          onAnchor: (anchor) => {
            console.log('Anchor received:', anchor);
            // Add to both local state and store
            setLocalAnchors((prev) => [...prev, anchor]);
            addAnchorImage(anchor);
          },
          onComplete: (result) => {
            console.log('Anchor generation complete:', result);
            setLocalImagesGenerated(true);
            setAnchorImagesComplete(true);
            setAnchorStreamStarted(false);
          },
          onError: (error) => {
            console.error('Anchor generation error:', error);
            setLocalImagesGenerated(true);
            setAnchorImagesComplete(true);
            setAnchorStreamStarted(false);
          },
        }
      );
    } else {
      console.log('[Review] Reusing existing anchor generation state');
      if (storeAnchorImagesComplete) {
        setAnchorStreamStarted(false);
      }
    }

    // Generate backstory
    generateBackstory(companionId, {
      archetype: state.archetype?.id || 'companion',
      secondaryArchetype: state.secondaryArchetype?.id,
      archetypeDescription: state.archetype?.description,
      personality: state.personality,
      tenets: state.tenets.map((t) => ({
        category: t.category,
        priority: t.priority,
        rule: t.rule,
        isNegation: t.isNegation,
      })),
      userBackstoryHint: state.identity.backstory || undefined,
    }).then((result) => {
      console.log('Backstory generated:', result);
      setBackstoryResult(result);
    }).catch((error) => {
      console.error('Backstory generation failed:', error);
      // Still allow progression even without backstory
      setBackstoryResult({ backstory: '', motivations: [], keyMemories: [], personalityQuirks: [], latencyMs: 0 });
    });
  }, [
    companionId,
    state,
    storeAnchorImages.length,
    storeAnchorImagesComplete,
    anchorStreamStarted,
    addAnchorImage,
    setAnchorImagesComplete,
    setAnchorStreamStarted,
  ]);

  // Phase transitions - loading → images → ready
  useEffect(() => {
    if (revealPhase !== 'loading') return;
    if (generatedAnchors.length > 0) {
      setRevealPhase('images');
      return;
    }
    if (imagesGenerated) {
      setRevealPhase('ready');
    }
  }, [generatedAnchors.length, imagesGenerated, revealPhase]);

  // Ensure first image appears when image phase starts.
  useEffect(() => {
    if (revealPhase === 'images' && generatedAnchors.length > 0 && visibleImageCount === 0) {
      setVisibleImageCount(1);
    }
  }, [revealPhase, generatedAnchors.length, visibleImageCount]);

  // Stagger image reveals
  useEffect(() => {
    if (revealPhase === 'images' && visibleImageCount < generatedAnchors.length) {
      const timer = setTimeout(() => {
        setVisibleImageCount((prev) => prev + 1);
      }, 600); // 600ms between each image
      return () => clearTimeout(timer);
    }
  }, [revealPhase, visibleImageCount, generatedAnchors.length]);

  // Transition to ready after all images shown
  useEffect(() => {
    if (revealPhase === 'images' && visibleImageCount >= generatedAnchors.length && generatedAnchors.length > 0 && imagesGenerated) {
      const timer = setTimeout(() => {
        setRevealPhase('ready');
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [revealPhase, visibleImageCount, generatedAnchors.length, imagesGenerated]);

  const createSessionForCompanion = useCallback(async () => {
    if (!companionId || localSessionId || isPreparingSession || isCreatingSessionRef.current) return;

    isCreatingSessionRef.current = true;
    setIsPreparingSession(true);
    setSessionError(null);

    try {
      const session = await createSession({
        companionId: companionId,
        title: `Chat with ${state.name}`,
      });
      console.log('Session created:', session);
      setLocalSessionId(session.id);
      storeSetSessionId(session.id);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('campfire:onboard-completion-session', session.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to prepare chat.';
      console.error('Failed to create session:', error);
      setSessionError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage || 'Failed to prepare chat. Please try again.',
        variant: 'destructive',
      });
    } finally {
      isCreatingSessionRef.current = false;
      setIsPreparingSession(false);
    }
  }, [companionId, localSessionId, isPreparingSession, state.name, storeSetSessionId, toast]);

  // Create session when we have enough generated content to continue.
  useEffect(() => {
    if (!companionId || localSessionId || isPreparingSession || sessionError) return;
    if (generatedAnchors.length === 0 && !imagesGenerated) return;
    void createSessionForCompanion();
  }, [companionId, localSessionId, isPreparingSession, sessionError, generatedAnchors.length, imagesGenerated, createSessionForCompanion]);

  // Handle ignite
  const handleIgnite = useCallback(() => {
    if (!localSessionId || isNavigatingToChat || !isInitialized) return;
    if (!isAuthenticated) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in again to continue to chat.',
        variant: 'destructive',
      });
      return;
    }

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('campfire:onboard-completion-session', localSessionId);
    }
    // Track onboarding completion
    trackOnboardingComplete('full', 6);
    setIsNavigatingToChat(true);
    if (igniteNavigationTimeoutRef.current) {
      window.clearTimeout(igniteNavigationTimeoutRef.current);
    }
    igniteNavigationTimeoutRef.current = window.setTimeout(() => {
      setIsNavigatingToChat(false);
    }, 1200);
    router.push(`/chat/${localSessionId}`);
  }, [isAuthenticated, isInitialized, isNavigatingToChat, localSessionId, router, toast]);

  if (!companionId) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center gap-6 px-4">
        <h2 className="text-3xl font-bold font-display text-white">Finish Setup First</h2>
        <p className="text-gray-400 max-w-md">
          We couldn&apos;t find a companion to review yet. Return to onboarding and complete voice selection.
        </p>
        <Button
          size="lg"
          onClick={() => {
            if (isAuthenticated) {
              router.push('/onboard?step=5');
            } else {
              router.push('/signup?returnTo=/onboard');
            }
          }}
          className="h-14 px-10 rounded-full bg-gradient-to-r from-vibes-cyan to-vibes-electric font-bold"
        >
          {isAuthenticated ? 'Back to Voice Step' : 'Sign Up to Continue'}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex flex-col items-center pt-16 md:pt-24">
      <AnimatePresence mode="wait">
        {/* Phase 1: Loading - Pulsing name */}
        {revealPhase === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5 }}
            className="text-center pt-8 md:pt-12"
          >
            <motion.h1
              data-testid="companion-name"
              className="text-5xl md:text-7xl font-bold font-display text-white"
              animate={{
                textShadow: [
                  '0 0 20px rgba(168, 85, 247, 0.3)',
                  '0 0 60px rgba(168, 85, 247, 0.6)',
                  '0 0 20px rgba(168, 85, 247, 0.3)',
                ],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              {state.name}
            </motion.h1>
            <motion.p
              className="text-gray-500 mt-4 text-sm tracking-widest uppercase"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              Awakening...
            </motion.p>
          </motion.div>
        )}

        {/* Phase 2: Image Reveal + Backstory Overlay */}
        {(revealPhase === 'images' || revealPhase === 'ready') && (
          <motion.div
            key="images"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center w-full max-w-xl mx-auto px-4"
          >
            {/* Hero image */}
            {generatedAnchors[0] && visibleImageCount >= 1 && (
              <motion.div
                data-testid="anchor-image-0"
                initial={{ scale: 0, rotate: -8, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 150, damping: 15 }}
                className="relative aspect-[3/4] w-full max-w-sm mx-auto rounded-2xl overflow-hidden"
              >
                {/* Glow burst */}
                <motion.div
                  initial={{ scale: 0.5, opacity: 0.9 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 0.8 }}
                  className="absolute inset-0 bg-vibes-neon/50 rounded-2xl blur-3xl -z-10"
                />
                {/* Border glow */}
                <div className="absolute inset-0 rounded-2xl border-2 border-vibes-neon/60 shadow-[0_0_60px_rgba(168,85,247,0.6)] z-10" />
                <Image
                  src={generatedAnchors[0].url}
                  alt={state.name}
                  fill
                  className="object-cover"
                  priority
                />
                {/* Identity & backstory overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/95 via-black/80 to-transparent z-20">
                  <h2 className="text-3xl font-bold font-display text-white mb-1">{state.name}</h2>
                  <p className="text-gray-300 text-xs uppercase tracking-wider">
                    {state.identity.pronouns} • {state.archetype?.name}
                    {state.secondaryArchetype && (
                      <>
                        {' + '}
                        <span className="text-vibes-cyan">{state.secondaryArchetype.name}</span>
                      </>
                    )}
                  </p>
                  <AnimatePresence>
                    {backstoryResult && (
                      <motion.p
                        key="backstory-overlay"
                        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: 16 }}
                        transition={{ delay: 0.2, duration: 0.45 }}
                        className="mt-2 text-sm leading-relaxed text-gray-100 font-light line-clamp-3"
                      >
                        {backstoryResult.backstory || `A ${state.archetype?.description?.toLowerCase() || 'unique'} companion waiting to connect.`}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* Thumbnails */}
            {generatedAnchors.length > 1 && (
              <div className="flex gap-3 justify-center mt-6">
                {generatedAnchors.slice(1).map((anchor, index) => (
                  visibleImageCount >= index + 2 && (
                    <motion.div
                      key={anchor.url}
                      data-testid={`anchor-image-${index + 1}`}
                      initial={{ scale: 0, y: 30, opacity: 0 }}
                      animate={{ scale: 1, y: 0, opacity: 1 }}
                      transition={{
                        type: 'spring',
                        stiffness: 200,
                        damping: 15,
                      }}
                      className="relative w-20 h-28 rounded-xl overflow-hidden border-2 border-white/20 shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                    >
                      {/* Thumbnail glow burst */}
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0.7 }}
                        animate={{ scale: 1.5, opacity: 0 }}
                        transition={{ duration: 0.5 }}
                        className="absolute inset-0 bg-vibes-cyan/40 blur-xl -z-10"
                      />
                      <Image
                        src={anchor.url}
                        alt={`${state.name} variant`}
                        fill
                        className="object-cover"
                      />
                    </motion.div>
                  )
                ))}
              </div>
            )}

            {/* IGNITE Button */}
            <AnimatePresence>
              {(revealPhase === 'ready' || visibleImageCount >= 1) && backstoryResult && (localSessionId || isPreparingSession || !!sessionError) && (
                <motion.div
                  initial={{ y: 50, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 150, damping: 15, delay: 0.3 }}
                  className="mt-10"
                >
                  {localSessionId ? (
                    <>
                      <Button
                        size="lg"
                        onClick={handleIgnite}
                        data-testid="ignite-button"
                        className="h-20 px-16 text-2xl font-bold rounded-2xl bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 hover:from-orange-400 hover:via-red-400 hover:to-pink-400 shadow-[0_0_40px_rgba(239,68,68,0.5)] hover:shadow-[0_0_60px_rgba(239,68,68,0.7)] transition-all duration-300 hover:scale-105 active:scale-95"
                      >
                        <Flame className="mr-3 h-8 w-8" />
                        IGNITE
                      </Button>
                      <p className="text-xs text-center text-gray-500 mt-6">
                        By igniting {state.name}, you agree to our{' '}
                        <a href="/terms" className="underline hover:text-gray-300 transition-colors">Terms</a> and{' '}
                        <a href="/privacy" className="underline hover:text-gray-300 transition-colors">Privacy Policy</a>.
                      </p>
                    </>
                  ) : isPreparingSession ? (
                    <div className="flex items-center justify-center gap-3 text-gray-300">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Preparing your chat...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      <p className="text-sm text-red-300">{sessionError}</p>
                      <Button
                        size="lg"
                        onClick={() => void createSessionForCompanion()}
                        className="h-14 px-8 rounded-full bg-gradient-to-r from-vibes-cyan to-vibes-electric font-bold"
                      >
                        Retry Chat Setup
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
