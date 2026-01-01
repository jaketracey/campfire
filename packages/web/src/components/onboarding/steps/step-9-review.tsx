'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOnboardingStore, type TenetCategory } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Sparkles, Star, ImageIcon, CheckCircle2, BookOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { createCompanion, createSession, streamAnchorImages, generateBackstory, type AnchorImage, type GenerateBackstoryResult } from '@/lib/api';
import { cn } from '@/lib/utils';
import Image from 'next/image';

// Tenet category metadata for display
const TENET_CATEGORY_META: Record<TenetCategory, { label: string; color: string }> = {
  communication: { label: 'Communication', color: 'cyan' },
  boundaries: { label: 'Boundaries', color: 'red' },
  engagement: { label: 'Engagement', color: 'green' },
  emotional: { label: 'Emotional', color: 'pink' },
  knowledge: { label: 'Knowledge', color: 'blue' },
  autonomy: { label: 'Autonomy', color: 'amber' },
};

type CreationPhase = 'idle' | 'creating' | 'generating-identity' | 'creating-session' | 'complete';

export function Step9Review() {
  const router = useRouter();
  const { toast } = useToast();
  const state = useOnboardingStore();
  const [phase, setPhase] = useState<CreationPhase>('idle');
  const [generatedAnchors, setGeneratedAnchors] = useState<AnchorImage[]>([]);
  const [currentAnchorIndex, setCurrentAnchorIndex] = useState(0);
  const [backstoryGenerated, setBackstoryGenerated] = useState(false);
  const [backstoryResult, setBackstoryResult] = useState<GenerateBackstoryResult | null>(null);
  const [imagesGenerated, setImagesGenerated] = useState(false);
  const [displayedAnchorUrl, setDisplayedAnchorUrl] = useState<string | null>(null);
  const [isImageFading, setIsImageFading] = useState(false);
  const backstoryRef = useRef<HTMLDivElement>(null);

  // Auto-scroll backstory after it appears
  useEffect(() => {
    if (backstoryResult && backstoryRef.current) {
      const scrollContainer = backstoryRef.current;
      const scrollHeight = scrollContainer.scrollHeight;
      const clientHeight = scrollContainer.clientHeight;

      // Only scroll if content overflows
      if (scrollHeight > clientHeight) {
        const timeout = setTimeout(() => {
          // Smooth scroll to bottom over 3 seconds
          const duration = 3000;
          const startTime = Date.now();
          const startScroll = scrollContainer.scrollTop;
          const targetScroll = scrollHeight - clientHeight;

          const animateScroll = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-in-out curve
            const eased = progress < 0.5
              ? 2 * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            scrollContainer.scrollTop = startScroll + (targetScroll - startScroll) * eased;

            if (progress < 1) {
              requestAnimationFrame(animateScroll);
            }
          };

          requestAnimationFrame(animateScroll);
        }, 2000); // Wait 2 seconds before starting scroll

        return () => clearTimeout(timeout);
      }
    }
  }, [backstoryResult]);

  const coreTenets = state.tenets.filter((t) => t.priority === 'core');
  const isCreating = phase !== 'idle';

  // Cycle through anchors with fade effect
  useEffect(() => {
    if (generatedAnchors.length === 0) {
      setDisplayedAnchorUrl(null);
      return;
    }

    // If first anchor just arrived, show it immediately
    if (generatedAnchors.length === 1 && !displayedAnchorUrl) {
      setDisplayedAnchorUrl(generatedAnchors[0].url);
      return;
    }

    // Cycle through anchors every 3 seconds when we have multiple
    if (generatedAnchors.length > 1) {
      const interval = setInterval(() => {
        setIsImageFading(true);
        setTimeout(() => {
          setCurrentAnchorIndex((prev) => (prev + 1) % generatedAnchors.length);
          setIsImageFading(false);
        }, 300); // Fade out duration
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [generatedAnchors.length, displayedAnchorUrl]);

  // Update displayed anchor when index changes
  useEffect(() => {
    if (generatedAnchors[currentAnchorIndex]) {
      setDisplayedAnchorUrl(generatedAnchors[currentAnchorIndex].url);
    }
  }, [currentAnchorIndex, generatedAnchors]);

  const handleCreate = async () => {
    setPhase('creating');
    setGeneratedAnchors([]);
    setCurrentAnchorIndex(0);
    setBackstoryGenerated(false);
    setImagesGenerated(false);

    try {
      // Build personality description from archetype and sliders
      const personalityDescription = [
        state.archetype?.description || '',
        state.secondaryArchetype
          ? `Secondary archetype: ${state.secondaryArchetype.name}`
          : '',
        `Traits: ${state.archetype?.traits.join(', ') || 'friendly'}`,
        `Warmth: ${state.personality.warmth}%, Playfulness: ${state.personality.playfulness}%`,
        `Empathy: ${state.personality.empathy}%, Energy: ${state.personality.energy}%`,
        state.identity.backstory ? `Background: ${state.identity.backstory}` : '',
        coreTenets.length > 0
          ? `Core behavioral rules:\n${coreTenets.map((t) => `- ${t.isNegation ? 'NEVER: ' : ''}${t.rule}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      // Create companion via API with full spec including visual_style
      const companion = await createCompanion({
        name: state.name,
        description: state.archetype?.description,
        personality: personalityDescription,
        voiceId: state.voice?.id,
        isPublic: false,
        spec: {
          identity: {
            name: state.name,
            pronouns: state.identity.pronouns,
          },
          personality: {
            archetype: state.archetype?.id || 'companion',
            secondary_archetype: state.secondaryArchetype?.id,
            traits: {
              warmth: state.personality.warmth,
              energy: state.personality.energy,
              playfulness: state.personality.playfulness,
              formality: state.personality.formality,
              assertiveness: state.personality.assertiveness,
              curiosity: state.personality.curiosity,
              empathy: state.personality.empathy,
              spontaneity: state.personality.spontaneity,
              optimism: state.personality.optimism,
              directness: state.personality.directness,
            },
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: state.voice?.id || 'default',
          },
          visual_style: {
            style_type: state.visualStyle.avatarStyle,
            appearance: {
              ethnicity: state.visualStyle.appearance.ethnicity,
              bodyType: state.visualStyle.appearance.bodyType,
              hairColor: state.visualStyle.appearance.hairColor,
              breastSize: state.visualStyle.appearance.breastSize,
            },
          },
          boundaries: {
            relationship_pacing: 'moderate',
            content_rating: 'R',
            emotional_depth: state.boundaries.emotionalDepth,
            topics_avoid: state.boundaries.avoidTopics,
            safe_topics: state.boundaries.safeTopics,
          },
        },
      });

      console.log('Companion created:', companion);

      // Generate identity: images (with SSE streaming) AND backstory in parallel
      setPhase('generating-identity');

      // Start streaming anchor images - resolve after FIRST anchor arrives
      // Additional anchors will continue generating in background
      let firstAnchorResolve: (() => void) | null = null;
      let firstAnchorReject: ((err: Error) => void) | null = null;
      const firstAnchorPromise = new Promise<void>((resolve, reject) => {
        firstAnchorResolve = resolve;
        firstAnchorReject = reject;
      });

      // Start the stream (continues in background even after we navigate away)
      streamAnchorImages(
        {
          companionId: companion.id,
          appearance: {
            ethnicity: state.visualStyle.appearance.ethnicity,
            bodyType: state.visualStyle.appearance.bodyType,
            hairColor: state.visualStyle.appearance.hairColor,
            breastSize: state.visualStyle.appearance.breastSize,
          },
          style: state.visualStyle.avatarStyle,
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
            setGeneratedAnchors((prev) => [...prev, anchor]);
            // Resolve after first anchor - user can proceed
            if (firstAnchorResolve) {
              firstAnchorResolve();
              firstAnchorResolve = null; // Only resolve once
            }
          },
          onComplete: (result) => {
            console.log('Anchor generation complete:', result);
            setImagesGenerated(true);
          },
          onError: (error) => {
            console.error('Anchor generation error:', error);
            // If we haven't gotten any anchors yet, reject
            if (firstAnchorReject) {
              firstAnchorReject(new Error(error.message));
              firstAnchorReject = null;
            }
            // Mark as complete if we got partial anchors
            if (error.partialAnchors && error.partialAnchors.length > 0) {
              setImagesGenerated(true);
            }
          },
        }
      );

      // Wait for FIRST anchor + backstory in parallel
      // Additional anchors continue generating in background (saved on server)
      const [anchorsResult, backstoryResultSettled] = await Promise.allSettled([
        firstAnchorPromise,
        // Generate backstory and save to knowledge graph
        generateBackstory(companion.id, {
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
          setBackstoryGenerated(true);
          return result;
        }),
      ]);

      // Handle any failures gracefully
      if (anchorsResult.status === 'rejected') {
        console.warn('Anchor generation failed:', anchorsResult.reason);
        toast({
          title: 'Note',
          description: 'Could not generate anchor images. Your companion will still work normally.',
          variant: 'default',
        });
      }

      if (backstoryResultSettled.status === 'rejected') {
        console.warn('Backstory generation failed:', backstoryResultSettled.reason);
        toast({
          title: 'Note',
          description: 'Could not generate backstory. Your companion will still work normally.',
          variant: 'default',
        });
      }

      // Create a session with the new companion
      setPhase('creating-session');
      const session = await createSession({
        companionId: companion.id,
        title: `Chat with ${companion.name}`,
      });

      console.log('Session created:', session);

      setPhase('complete');

      // Brief delay to show completion state
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Reset onboarding state
      state.reset();

      // Navigate to chat with new session
      router.push(`/chat/${session.id}`);
    } catch (error) {
      console.error('Failed to create companion:', error);
      toast({
        title: 'Error',
        description: 'Failed to create companion. Please try again.',
        variant: 'destructive',
      });
      setPhase('idle');
    }
  };

  const getCategoryStyle = (category: string) => {
    const meta = TENET_CATEGORY_META[category as keyof typeof TENET_CATEGORY_META];
    if (!meta) return 'bg-gray-500/20 text-gray-400';
    const colorMap: Record<string, string> = {
      cyan: 'bg-vibes-cyan/20 text-vibes-cyan',
      red: 'bg-red-500/20 text-red-400',
      green: 'bg-green-500/20 text-green-400',
      pink: 'bg-pink-500/20 text-pink-400',
      blue: 'bg-blue-500/20 text-blue-400',
      amber: 'bg-amber-500/20 text-amber-400',
    };
    return colorMap[meta.color] || colorMap.cyan;
  };

  return (
    <div className="space-y-10">
      <div className="text-center space-y-3">
        <h2 className="text-4xl md:text-5xl font-bold font-display tracking-tight text-white leading-tight">
          Review your <span className="text-vibes-neon">Companion</span>
        </h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Ready to ignite {state.name} and bring them into the digital campfire?
        </p>
      </div>

      <Card className="bg-white/[0.02] backdrop-blur-3xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan" />
        <CardContent className="p-8">
          {/* Dynamic layout: side-by-side when generating, stacked otherwise */}
          <div className={cn(
            'transition-all duration-700 ease-out',
            displayedAnchorUrl ? 'flex gap-8' : 'space-y-8'
          )}>
            {/* Left side: Avatar that grows dramatically when generating */}
            <div className={cn(
              'transition-all duration-700 ease-out shrink-0',
              displayedAnchorUrl ? 'w-64' : 'w-auto'
            )}>
              <div className="flex items-center gap-6">
                {/* Avatar/Icon with live preview when anchors arrive */}
                <div
                  className={cn(
                    'relative overflow-hidden transition-all duration-700 ease-out',
                    displayedAnchorUrl
                      ? 'h-80 w-64 rounded-2xl'  // MUCH larger when showing generated images
                      : 'h-20 w-20 rounded-3xl'   // Square when showing icon
                  )}
                >
                  {displayedAnchorUrl ? (
                    <>
                      {/* Glow effect */}
                      <div className="absolute inset-0 bg-gradient-to-br from-vibes-neon/20 via-transparent to-vibes-hot/20 z-10 pointer-events-none" />
                      {/* Image with fade transition */}
                      <Image
                        src={displayedAnchorUrl}
                        alt={`${state.name} preview`}
                        fill
                        className={cn(
                          'object-cover transition-all duration-300',
                          isImageFading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
                        )}
                        priority
                      />
                      {/* Border overlay */}
                      <div className="absolute inset-0 border-2 border-vibes-neon/40 rounded-2xl shadow-[0_0_40px_rgba(168,85,247,0.5)] z-20" />
                      {/* Name overlay at bottom */}
                      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent z-30">
                        <h3 className="text-2xl font-bold font-display text-white">{state.name}</h3>
                        <p className="text-gray-400 text-sm font-medium">
                          {state.identity.pronouns} • {state.archetype?.name}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="h-full w-full bg-vibes-neon/10 flex items-center justify-center text-4xl border border-vibes-neon/20 shadow-[0_0_20px_rgba(168,85,247,0.2)] rounded-3xl">
                      {phase === 'generating-identity' ? (
                        <Loader2 className="h-8 w-8 text-vibes-neon animate-spin" />
                      ) : (
                        state.archetype?.icon
                      )}
                    </div>
                  )}
                </div>
                {/* Name/title - only show when no image yet */}
                {!displayedAnchorUrl && (
                  <div>
                    <h3 className="text-3xl font-bold font-display text-white">{state.name}</h3>
                    <p className="text-gray-500 font-medium">
                      {state.identity.pronouns} •{' '}
                      <span className="text-vibes-neon">{state.archetype?.name}</span>
                      {state.secondaryArchetype && (
                        <>
                          {' + '}
                          <span className="text-vibes-cyan">{state.secondaryArchetype.name}</span>
                        </>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {/* Image progress dots - show under image when generating */}
              {phase === 'generating-identity' && displayedAnchorUrl && (
                <div className="flex gap-2 justify-center mt-4">
                  {['neutral', 'happy', 'thoughtful'].map((emotionalState, index) => {
                    const isComplete = generatedAnchors.some((a) => a.emotionalState === emotionalState);
                    const isCurrent = index === generatedAnchors.length && !imagesGenerated;
                    return (
                      <div
                        key={emotionalState}
                        className={cn(
                          'h-2 w-2 rounded-full transition-all duration-300',
                          isComplete
                            ? 'bg-vibes-neon scale-100'
                            : isCurrent
                              ? 'bg-vibes-neon/50 animate-pulse scale-110'
                              : 'bg-white/20 scale-75'
                        )}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right side: Content that adapts */}
            <div className={cn(
              'flex-1 transition-all duration-500',
              displayedAnchorUrl ? 'opacity-100' : ''
            )}>
              {/* When generating with image: show generation status */}
              {phase === 'generating-identity' && displayedAnchorUrl ? (
                <div className="h-full flex flex-col justify-center space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-5 w-5 text-vibes-neon animate-pulse" />
                      <span className="text-sm font-bold tracking-widest text-vibes-neon uppercase">Creating Identity</span>
                    </div>
                    <h4 className="text-2xl font-bold text-white mb-1">
                      {imagesGenerated && backstoryGenerated ? 'Ready!' : 'Almost there...'}
                    </h4>
                    <p className="text-gray-400">
                      Crafting {state.name}&apos;s unique personality and memories
                    </p>
                  </div>

                  {/* Backstory reveal */}
                  <div className="space-y-4">
                    {backstoryResult ? (
                      /* Revealed backstory content */
                      <div
                        ref={backstoryRef}
                        className="animate-in fade-in slide-in-from-bottom-2 duration-700 space-y-4 max-h-64 overflow-y-auto pr-2 scrollbar-subtle"
                        style={{
                          scrollbarWidth: 'thin',
                          scrollbarColor: 'rgba(255,255,255,0.1) transparent',
                        }}
                      >
                        {/* Backstory text */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-vibes-cyan shrink-0" />
                            <span className="text-xs font-bold tracking-widest text-vibes-cyan uppercase">Backstory</span>
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed">
                            {backstoryResult.backstory}
                          </p>
                        </div>

                        {/* Motivations */}
                        {backstoryResult.motivations && backstoryResult.motivations.length > 0 && (
                          <div className="space-y-2 animate-in fade-in duration-500 delay-200">
                            <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">Motivations</span>
                            <div className="flex gap-2 flex-wrap">
                              {backstoryResult.motivations.slice(0, 3).map((m, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded-full bg-vibes-cyan/10 border border-vibes-cyan/20 text-vibes-cyan text-xs"
                                >
                                  {m}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Key memories */}
                        {backstoryResult.keyMemories && backstoryResult.keyMemories.length > 0 && (
                          <div className="space-y-2 animate-in fade-in duration-500 delay-300">
                            <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">Key Memories</span>
                            <ul className="space-y-1">
                              {backstoryResult.keyMemories.slice(0, 2).map((m, i) => (
                                <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                                  <span className="text-vibes-neon mt-0.5">•</span>
                                  <span>{m}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Personality quirks */}
                        {backstoryResult.personalityQuirks && backstoryResult.personalityQuirks.length > 0 && (
                          <div className="space-y-2 animate-in fade-in duration-500 delay-400">
                            <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">Quirks</span>
                            <div className="flex gap-2 flex-wrap">
                              {backstoryResult.personalityQuirks.slice(0, 3).map((q, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded-full bg-vibes-hot/10 border border-vibes-hot/20 text-vibes-hot text-xs"
                                >
                                  {q}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Loading state */
                      <>
                        <div className="flex items-center gap-3">
                          <BookOpen className="h-5 w-5 text-vibes-cyan animate-pulse" />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-white">Backstory & Memories</div>
                            <div className="text-xs text-gray-500">Generating unique history...</div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full w-2/3 rounded-full bg-vibes-cyan/50 animate-pulse" />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Traits preview */}
                  <div className="pt-2">
                    <div className="flex gap-2 flex-wrap">
                      {state.archetype?.traits.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-gray-400 text-xs"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Default review content */
                <>
                  {displayedAnchorUrl && <Separator className="bg-white/5 mb-8" />}
                  {!displayedAnchorUrl && <Separator className="bg-white/5" />}
                  <div className={cn("grid grid-cols-2 gap-8 text-sm", displayedAnchorUrl && "mt-0")}>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                        Voice
                      </span>
                      <span className="text-lg font-bold text-gray-200 block">{state.voice?.name}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                        Visual Style
                      </span>
                      <span className="text-lg font-bold text-gray-200 block capitalize">
                        {state.visualStyle.avatarStyle}
                      </span>
                    </div>

                    <div className="col-span-2 space-y-3">
                      <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                        Personality Traits
                      </span>
                      <div className="flex gap-2 flex-wrap">
                        {state.archetype?.traits.map((t) => (
                          <span
                            key={t}
                            className="px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/5 text-gray-300 text-xs font-bold"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>

                    {coreTenets.length > 0 && (
                      <div className="col-span-2 space-y-3">
                        <div className="flex items-center gap-2">
                          <Star className="h-3 w-3 text-vibes-acid" />
                          <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                            Core Behavioral Rules
                          </span>
                        </div>
                        <div className="space-y-2">
                          {coreTenets.map((tenet) => (
                            <div
                              key={tenet.id}
                              className="flex items-center gap-2 text-sm text-gray-300"
                            >
                              <Badge className={cn('text-[10px] shrink-0', getCategoryStyle(tenet.category))}>
                                {TENET_CATEGORY_META[tenet.category]?.label}
                              </Badge>
                              {tenet.isNegation && (
                                <span className="text-red-400 text-xs font-bold">NEVER:</span>
                              )}
                              <span className="line-clamp-1">{tenet.rule}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Identity Generation Progress - only show when no image yet */}
      {phase === 'generating-identity' && !displayedAnchorUrl && (
        <Card className="bg-white/[0.02] backdrop-blur-3xl border-white/10 overflow-hidden">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Sparkles className="h-6 w-6 text-vibes-neon animate-pulse" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-white">Creating {state.name}&apos;s Identity</h4>
                <p className="text-sm text-gray-400">
                  Generating unique visuals and backstory...
                </p>
              </div>
            </div>

            {/* Two parallel progress sections */}
            <div className="grid grid-cols-2 gap-6">
              {/* Images progress */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {imagesGenerated ? (
                    <CheckCircle2 className="h-4 w-4 text-vibes-neon" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-vibes-neon animate-pulse" />
                  )}
                  <span className="text-sm font-medium text-gray-300">Visual Identity</span>
                </div>

                {/* Progress indicator */}
                <div className="flex gap-1.5">
                  {['neutral', 'happy', 'thoughtful'].map((emotionalState, index) => {
                    const isComplete = generatedAnchors.some((a) => a.emotionalState === emotionalState);
                    const isCurrent = index === generatedAnchors.length && !imagesGenerated;

                    return (
                      <div
                        key={emotionalState}
                        className={cn(
                          'flex-1 h-1.5 rounded-full transition-all duration-500',
                          isComplete
                            ? 'bg-vibes-neon'
                            : isCurrent
                              ? 'bg-vibes-neon/50 animate-pulse'
                              : 'bg-white/10'
                        )}
                      />
                    );
                  })}
                </div>

                {/* Generated anchors preview */}
                {generatedAnchors.length > 0 && (
                  <div className="flex gap-2 justify-center pt-1">
                    {generatedAnchors.map((anchor) => (
                      <div
                        key={anchor.id}
                        className="relative w-12 h-18 rounded-md overflow-hidden border border-vibes-neon/30 shadow-[0_0_8px_rgba(168,85,247,0.2)]"
                      >
                        <Image
                          src={anchor.url}
                          alt={`${state.name} - ${anchor.emotionalState}`}
                          fill
                          className="object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Backstory progress */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {backstoryGenerated ? (
                    <CheckCircle2 className="h-4 w-4 text-vibes-cyan" />
                  ) : (
                    <BookOpen className="h-4 w-4 text-vibes-cyan animate-pulse" />
                  )}
                  <span className="text-sm font-medium text-gray-300">Backstory & Memories</span>
                </div>

                {/* Single progress bar for backstory */}
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-1000',
                      backstoryGenerated
                        ? 'w-full bg-vibes-cyan'
                        : 'w-2/3 bg-vibes-cyan/50 animate-pulse'
                    )}
                  />
                </div>

                {backstoryGenerated && (
                  <p className="text-xs text-gray-500 pt-1">
                    Motivations, memories, and personality saved ✓
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="pt-6 space-y-6">
        <Button
          size="lg"
          className="w-full h-20 text-2xl font-bold rounded-2xl bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all duration-500 hover:scale-[1.02] active:scale-[0.98] text-white"
          onClick={handleCreate}
          disabled={isCreating}
        >
          {phase === 'idle' ? (
            <>
              <Sparkles className="mr-3 h-8 w-8" />
              Bring to Life
            </>
          ) : phase === 'creating' ? (
            <>
              <Loader2 className="mr-3 h-8 w-8 animate-spin" />
              Creating {state.name}...
            </>
          ) : phase === 'generating-identity' ? (
            <>
              <Loader2 className="mr-3 h-8 w-8 animate-spin" />
              Building Identity...
            </>
          ) : phase === 'creating-session' ? (
            <>
              <Loader2 className="mr-3 h-8 w-8 animate-spin" />
              Preparing Chat...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-3 h-8 w-8" />
              Ready!
            </>
          )}
        </Button>
        <p className="text-xs text-center text-gray-500 font-medium">
          By igniting {state.name}, you agree to our{' '}
          <span className="underline cursor-pointer">Terms of Service</span> and{' '}
          <span className="underline cursor-pointer">Privacy Policy</span>.
        </p>
      </div>
    </div>
  );
}
