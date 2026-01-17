'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Flame } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { createSession, streamAnchorImages, generateBackstory, type AnchorImage, type GenerateBackstoryResult } from '@/lib/api';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { trackOnboardingStep, trackOnboardingComplete, trackEvent } from '@/lib/analytics/meta-pixel';

type RevealPhase = 'loading' | 'backstory' | 'images' | 'ready';

export function Step9Review() {
  const router = useRouter();
  const { toast } = useToast();
  const state = useOnboardingStore();
  const {
    companionId,
    sessionId: storedSessionId,
    setSessionId: storeSetSessionId,
    anchorImages: storeAnchorImages,
    anchorImagesComplete: storeAnchorImagesComplete,
    addAnchorImage,
    setAnchorImagesComplete,
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
  const hasConnectedRef = useRef(false);
  const hasTrackedRef = useRef(false);

  // Track step on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      trackOnboardingStep(6, 'review', 'full');
      hasTrackedRef.current = true;
    }
  }, []);

  // Auto-connect to generation stream on mount (skip if we already have images from Surprise Me)
  useEffect(() => {
    if (!companionId || hasConnectedRef.current) return;
    hasConnectedRef.current = true;

    // If we already have images from Surprise Me, skip streaming
    if (storeAnchorImages.length > 0) {
      console.log('[Review] Using pre-generated images from Surprise Me:', storeAnchorImages.length);
      // Images are already in the store, no need to stream
    } else {
      // Connect to anchor image stream
      console.log('[Review] Starting anchor image stream');
      streamAnchorImages(
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
          },
          onError: (error) => {
            console.error('Anchor generation error:', error);
            if (error.partialAnchors && error.partialAnchors.length > 0) {
              setLocalImagesGenerated(true);
              setAnchorImagesComplete(true);
            }
          },
        }
      );
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
  }, [companionId, state, storeAnchorImages.length, addAnchorImage, setAnchorImagesComplete, toast]);

  // Phase transitions
  useEffect(() => {
    if (backstoryResult && revealPhase === 'loading') {
      setRevealPhase('backstory');
    }
  }, [backstoryResult, revealPhase]);

  // Transition from backstory to images after delay
  useEffect(() => {
    if (revealPhase === 'backstory' && generatedAnchors.length > 0) {
      const timer = setTimeout(() => {
        setRevealPhase('images');
      }, 3000); // 3 seconds to read backstory
      return () => clearTimeout(timer);
    }
  }, [revealPhase, generatedAnchors.length]);

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

  // Create session when we have content
  useEffect(() => {
    if (!companionId || localSessionId) return;
    if (generatedAnchors.length === 0 && !imagesGenerated) return;

    createSession({
      companionId: companionId,
      title: `Chat with ${state.name}`,
    }).then((session) => {
      console.log('Session created:', session);
      setLocalSessionId(session.id);
      storeSetSessionId(session.id);
    }).catch((error) => {
      console.error('Failed to create session:', error);
      toast({
        title: 'Error',
        description: 'Failed to prepare chat. Please try again.',
        variant: 'destructive',
      });
    });
  }, [companionId, generatedAnchors.length, imagesGenerated, localSessionId, state.name, storeSetSessionId, toast]);

  // Handle ignite
  const handleIgnite = useCallback(() => {
    if (!localSessionId) return;
    // Track onboarding completion
    trackOnboardingComplete('full', 6);
    state.reset();
    router.push(`/chat/${localSessionId}`);
  }, [localSessionId, state, router]);

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

        {/* Phase 2: Backstory Reveal */}
        {revealPhase === 'backstory' && backstoryResult && (
          <motion.div
            key="backstory"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-2xl md:max-w-4xl mx-auto px-4 pt-8 md:pt-12"
          >
            {/* Name - larger */}
            <motion.h1
              initial={{ y: 30, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 100, damping: 15 }}
              className="text-5xl md:text-8xl font-bold font-display text-white mb-2"
              style={{
                textShadow: '0 0 40px rgba(168, 85, 247, 0.5)',
              }}
            >
              {state.name}
            </motion.h1>

            {/* Pronouns + Archetype */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="text-gray-400 text-base md:text-lg mb-6 md:mb-8"
            >
              {state.identity.pronouns} •{' '}
              <span className="text-vibes-neon">{state.archetype?.name}</span>
              {state.secondaryArchetype && (
                <>
                  {' + '}
                  <span className="text-vibes-cyan">{state.secondaryArchetype.name}</span>
                </>
              )}
            </motion.p>

            {/* Backstory text */}
            <motion.div
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ delay: 0.5, duration: 1.2 }}
            >
              <p className="text-base md:text-xl text-gray-300 leading-relaxed font-light">
                {backstoryResult.backstory || `A ${state.archetype?.description?.toLowerCase() || 'unique'} companion waiting to connect.`}
              </p>
            </motion.div>

            {/* Traits */}
            {state.archetype?.traits && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5, duration: 0.6 }}
                className="flex gap-3 justify-center flex-wrap mt-8"
              >
                {state.archetype.traits.map((trait, i) => (
                  <motion.span
                    key={trait}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1.7 + i * 0.1 }}
                    className="px-4 py-2 rounded-full bg-white/[0.05] border border-white/10 text-gray-300 text-sm"
                  >
                    {trait}
                  </motion.span>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Phase 3: Image Reveal */}
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
                {/* Name overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20">
                  <h2 className="text-3xl font-bold font-display text-white">{state.name}</h2>
                  <p className="text-gray-300 text-sm">
                    {state.identity.pronouns} • {state.archetype?.name}
                  </p>
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
              {revealPhase === 'ready' && localSessionId && (
                <motion.div
                  initial={{ y: 50, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 150, damping: 15, delay: 0.3 }}
                  className="mt-10"
                >
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
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
