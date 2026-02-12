'use client';

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useOnboardingStore, type VoiceOption } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Play, Pause, ArrowRight, Loader2, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createCompanion, updateCompanion } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { trackOnboardingStep, trackCompanionCreated } from '@/lib/analytics/meta-pixel';

// ElevenLabs voices for companion creation
const voices: VoiceOption[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, warm, and naturally alluring.', sampleUrl: '', gender: 'feminine' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Calm, soothing, with a hint of playfulness.', sampleUrl: '', gender: 'feminine' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Elegant, seductive, and confident.', sampleUrl: '', gender: 'feminine' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Sweet, youthful, and energetic.', sampleUrl: '', gender: 'feminine' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', description: 'Expressive, friendly, and engaging.', sampleUrl: '', gender: 'feminine' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep, resonant, and authoritative.', sampleUrl: '', gender: 'masculine' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', description: 'Smooth, charming, and sophisticated.', sampleUrl: '', gender: 'masculine' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', description: 'Warm, intimate, and captivating.', sampleUrl: '', gender: 'masculine' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Friendly, playful, and inviting.', sampleUrl: '', gender: 'neutral' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Rich, thoughtful, and comforting.', sampleUrl: '', gender: 'masculine' },
];

// Build the voice sample URL with customization params
function getVoiceSampleUrl(voiceId: string): string {
  const baseUrl = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3002'
    : '';
  // Use flirty voice settings: lower stability for more expression, higher style for personality
  const params = new URLSearchParams({
    stability: '0.35',
    similarityBoost: '0.75',
    style: '0.45',
    speed: '0.95',
  });
  return `${baseUrl}/api/v1/voice/${voiceId}/sample?${params.toString()}`;
}

export function Step7Voice() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const state = useOnboardingStore();
  const {
    voice,
    setVoice,
    nextStep,
    setCompanionId,
    setGenerationStarted,
    clearAnchorImages,
    setAppearanceChangedAfterGeneration,
    setAnchorAppearanceSnapshot,
    setAnchorStreamStarted,
  } = state;
  const { toast } = useToast();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSurprising, setIsSurprising] = useState(false);
  const [highlightedVoice, setHighlightedVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasTrackedRef = useRef(false);

  // Track step on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      trackOnboardingStep(5, 'voice', 'full');
      hasTrackedRef.current = true;
    }
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const coreTenets = state.tenets.filter((t) => t.priority === 'core');

  const persistVoiceSelection = useCallback(async (selectedVoice: VoiceOption): Promise<boolean> => {
    if (!isAuthenticated) {
      router.push(`/signup?returnTo=${encodeURIComponent('/onboard?step=5')}`);
      return false;
    }

    // If a companion already exists (e.g. from Surprise Me), persist the current selection.
    if (state.companionId) {
      await updateCompanion(state.companionId, {
        spec: {
          identity: {
            name: state.name,
            pronouns: state.identity.pronouns,
          },
          personality: {
            archetype: state.archetype?.id,
            secondary_archetype: state.secondaryArchetype?.id,
            traits: {
              warmth: state.personality.warmth / 100,
              energy: state.personality.energy / 100,
              playfulness: state.personality.playfulness / 100,
              formality: state.personality.formality / 100,
              assertiveness: state.personality.assertiveness / 100,
              curiosity: state.personality.curiosity / 100,
              empathy: state.personality.empathy / 100,
              spontaneity: state.personality.spontaneity / 100,
              optimism: state.personality.optimism / 100,
              directness: state.personality.directness / 100,
            },
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: selectedVoice.id,
          },
          visual_style: {
            appearance: state.visualStyle.appearance,
          },
        },
      });

      if (state.appearanceChangedAfterGeneration) {
        clearAnchorImages();
        setAnchorAppearanceSnapshot(state.visualStyle.appearance);
        setAppearanceChangedAfterGeneration(false);
        setAnchorStreamStarted(false);
      }

      return true;
    }

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

    const companion = await createCompanion({
      name: state.name,
      description: state.archetype?.description,
      personality: personalityDescription,
      voiceId: selectedVoice.id,
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
            warmth: state.personality.warmth / 100,
            energy: state.personality.energy / 100,
            playfulness: state.personality.playfulness / 100,
            formality: state.personality.formality / 100,
            assertiveness: state.personality.assertiveness / 100,
            curiosity: state.personality.curiosity / 100,
            empathy: state.personality.empathy / 100,
            spontaneity: state.personality.spontaneity / 100,
            optimism: state.personality.optimism / 100,
            directness: state.personality.directness / 100,
          },
        },
        voice: {
          provider: 'elevenlabs',
          voice_id: selectedVoice.id,
        },
        visual_style: {
          style_type: 'realistic',
          appearance: state.visualStyle.appearance,
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

    setCompanionId(companion.id);
    setGenerationStarted(true);
    trackCompanionCreated(companion.id);
    clearAnchorImages();
    setAnchorAppearanceSnapshot(state.visualStyle.appearance);
    setAnchorStreamStarted(false);
    return true;
  }, [isAuthenticated, router, state, clearAnchorImages, setAnchorAppearanceSnapshot, setAppearanceChangedAfterGeneration, setAnchorStreamStarted, coreTenets, setCompanionId, setGenerationStarted]);

  const handleProceed = useCallback(async () => {
    if (!voice) return;
    setIsCreating(true);

    try {
      const shouldProceed = await persistVoiceSelection(voice);
      if (shouldProceed) {
        nextStep();
      } else {
        setIsCreating(false);
      }
    } catch (error) {
      console.error('Failed to create companion:', error);
      toast({
        title: 'Error',
        description: 'Failed to create companion. Please try again.',
        variant: 'destructive',
      });
      setIsCreating(false);
    }
  }, [voice, persistVoiceSelection, nextStep, toast]);

  // Surprise Me - randomly select a voice with animation, then proceed.
  const handleSurpriseMe = useCallback(async () => {
    setIsSurprising(true);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
    }

    const targetIndex = Math.floor(Math.random() * voices.length);
    const targetVoice = voices[targetIndex];

    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const randomIndex = Math.floor(Math.random() * voices.length);
      setHighlightedVoice(voices[randomIndex].id);
      await new Promise((r) => setTimeout(r, 80 + i * 15));
    }

    setHighlightedVoice(targetVoice.id);
    setVoice(targetVoice);

    await new Promise((r) => setTimeout(r, 400));
    setIsSurprising(false);
    setHighlightedVoice(null);
    setIsCreating(true);

    try {
      const shouldProceed = await persistVoiceSelection(targetVoice);
      if (shouldProceed) {
        nextStep();
      } else {
        setIsCreating(false);
      }
    } catch (error) {
      console.error('Failed to create companion:', error);
      toast({
        title: 'Error',
        description: 'Failed to create companion. Please try again.',
        variant: 'destructive',
      });
      setIsCreating(false);
    }
  }, [setVoice, persistVoiceSelection, nextStep, toast]);

  const togglePlay = useCallback(async (id: string) => {
    // If already playing this voice, stop it
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setLoadingId(id);
    setPlayingId(null);

    try {
      const sampleUrl = getVoiceSampleUrl(id);
      const audio = new Audio(sampleUrl);
      audioRef.current = audio;

      audio.oncanplaythrough = () => {
        setLoadingId(null);
        setPlayingId(id);
        audio.play().catch(console.error);
      };

      audio.onended = () => {
        setPlayingId(null);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setLoadingId(null);
        setPlayingId(null);
        audioRef.current = null;
        // Silently fail - voice preview is optional
      };

      audio.load();
    } catch (error) {
      setLoadingId(null);
      setPlayingId(null);
      console.error('Failed to play voice sample:', error);
    }
  }, [playingId]);

  const handleVoiceCardKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, selectedVoice: VoiceOption) => {
    if (isSurprising) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setVoice(selectedVoice);
    }
  }, [isSurprising, setVoice]);

  return (
    <div className="space-y-8">
      <div className="text-left md:text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Choose a voice</h2>
        <p className="text-gray-400 max-w-md mx-auto">Select the voice that best fits your companion&apos;s essence.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {voices.map((v) => {
          const isHighlighted = highlightedVoice === v.id;
          const isSelected = voice?.id === v.id;
          return (
          <motion.div
            key={v.id}
            whileHover={isSurprising ? {} : { x: 5 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            animate={isHighlighted ? {
              scale: [1, 1.02, 1.01],
              transition: { duration: 0.1 }
            } : {}}
          >
            <Card
              data-testid={`voice-option-${v.name}`}
              role="button"
              tabIndex={isSurprising ? -1 : 0}
              aria-pressed={isSelected}
              aria-label={`Select voice ${v.name}`}
              className={cn(
                'flex items-center p-5 transition-all border-white/10 cursor-pointer overflow-hidden relative group',
                isHighlighted
                  ? 'bg-vibes-cyan/20 border-vibes-cyan ring-2 ring-vibes-cyan shadow-[0_0_30px_rgba(6,182,212,0.4)] backdrop-blur-xl'
                  : isSelected
                  ? 'bg-white/[0.08] border-vibes-cyan/50 ring-1 ring-vibes-cyan/30 backdrop-blur-xl'
                  : 'bg-white/[0.01] hover:bg-white/[0.03] backdrop-blur-md'
              )}
              onClick={() => !isSurprising && setVoice(v)}
              onKeyDown={(event) => handleVoiceCardKeyDown(event, v)}
            >
              <div className="flex-1 z-10">
                <div className="flex items-center gap-5">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={loadingId === v.id}
                    data-testid={`voice-play-${v.name}`}
                    className={cn(
                      "rounded-full h-14 w-14 aspect-square flex-shrink-0 transition-all duration-300",
                      playingId === v.id ? "bg-vibes-cyan text-black" : "bg-white/5 group-hover:bg-white/10 text-vibes-cyan"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay(v.id);
                    }}
                  >
                    {loadingId === v.id ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : playingId === v.id ? (
                      <Pause className="h-6 w-6 fill-current" />
                    ) : (
                      <Play className="h-6 w-6 ml-1 fill-current" />
                    )}
                  </Button>
                  <div>
                    <h3 className="text-xl font-display font-bold text-white group-hover:text-vibes-cyan transition-colors">{v.name}</h3>
                    <p className="text-sm text-gray-500">{v.description}</p>
                  </div>
                </div>
              </div>

              {(playingId === v.id || loadingId === v.id) && (
                <div className="flex items-center gap-1.5 px-6 animate-fade-in">
                  <div className="flex gap-1 items-end h-8">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <motion.div
                        key={i}
                        className={cn(
                          "w-1.5 rounded-full",
                          loadingId === v.id
                            ? "bg-gradient-to-t from-gray-600 to-gray-400"
                            : "bg-gradient-to-t from-vibes-electric to-vibes-cyan"
                        )}
                        animate={{
                          height: loadingId === v.id ? [8, 12, 8] : [8, 24, 12, 28, 10],
                        }}
                        transition={{
                          duration: loadingId === v.id ? 0.8 : 0.6,
                          repeat: Infinity,
                          delay: i * 0.1,
                          ease: "easeInOut"
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="z-10 px-4 py-1.5 bg-white/5 rounded-full border border-white/5 text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                {v.gender}
              </div>
            </Card>
          </motion.div>
        );
        })}
      </div>

      <div className="flex justify-end pt-8">
        <Button
          size="lg"
          disabled={!voice || isCreating || isSurprising}
          onClick={handleProceed}
          data-testid="review-and-ignite"
          className="group h-16 px-14 rounded-full bg-gradient-to-r from-vibes-cyan to-vibes-electric hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-xl"
        >
          {isCreating ? (
            <>
              <Loader2 className="mr-3 h-6 w-6 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              Review & Ignite
              <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-300" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
