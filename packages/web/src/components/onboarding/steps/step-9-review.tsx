'use client';

import { useState, useEffect, useRef } from 'react';
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
  const [imagesGenerated, setImagesGenerated] = useState(false);
  const [displayedAnchorUrl, setDisplayedAnchorUrl] = useState<string | null>(null);
  const [isImageFading, setIsImageFading] = useState(false);

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

      // Start streaming anchor images (will update state as each arrives)
      const anchorStreamPromise = new Promise<void>((resolve, reject) => {
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
            },
            onComplete: (result) => {
              console.log('Anchor generation complete:', result);
              setImagesGenerated(true);
              resolve();
            },
            onError: (error) => {
              console.error('Anchor generation error:', error);
              // Still resolve - we might have partial anchors
              if (error.partialAnchors && error.partialAnchors.length > 0) {
                setImagesGenerated(true);
              }
              reject(new Error(error.message));
            },
          }
        );
      });

      // Run anchor streaming and backstory generation in parallel
      const [anchorsResult, backstoryResult] = await Promise.allSettled([
        anchorStreamPromise,
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

      if (backstoryResult.status === 'rejected') {
        console.warn('Backstory generation failed:', backstoryResult.reason);
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
        <CardContent className="p-8 space-y-8">
          <div className="flex items-center gap-6">
            {/* Avatar/Icon with live preview when anchors arrive */}
            <div
              className={cn(
                'relative overflow-hidden transition-all duration-500 ease-out',
                displayedAnchorUrl
                  ? 'h-32 w-24 rounded-2xl'  // Larger when showing generated images
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
                  <div className="absolute inset-0 border-2 border-vibes-neon/40 rounded-2xl shadow-[0_0_30px_rgba(168,85,247,0.4)] z-20" />
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
          </div>

          <Separator className="bg-white/5" />

          <div className="grid grid-cols-2 gap-8 text-sm">
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
        </CardContent>
      </Card>

      {/* Identity Generation Progress */}
      {phase === 'generating-identity' && (
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
