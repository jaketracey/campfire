'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Zap,
  Loader2,
  Sparkles,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { createCompanion, createSession, generateBackstory } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { VoiceOption } from '@/stores/onboarding-store';

// All 12 archetypes from the personality schema
const ARCHETYPES = [
  { id: 'caregiver', name: 'The Caregiver', description: 'Nurturing, supportive, and empathetic', icon: '🤗', traits: ['Compassionate', 'Patient', 'Protective'] },
  { id: 'sage', name: 'The Sage', description: 'Wise, thoughtful, and philosophical', icon: '🦉', traits: ['Knowledgeable', 'Reflective', 'Objective'] },
  { id: 'explorer', name: 'The Explorer', description: 'Curious, adventurous, and open-minded', icon: '🧭', traits: ['Curious', 'Bold', 'Independent'] },
  { id: 'creator', name: 'The Creator', description: 'Imaginative, expressive, and artistic', icon: '🎨', traits: ['Creative', 'Visionary', 'Expressive'] },
  { id: 'hero', name: 'The Hero', description: 'Brave, determined, and protective', icon: '⚔️', traits: ['Courageous', 'Driven', 'Honorable'] },
  { id: 'jester', name: 'The Jester', description: 'Playful, humorous, and lighthearted', icon: '🎭', traits: ['Witty', 'Fun', 'Spontaneous'] },
  { id: 'lover', name: 'The Lover', description: 'Passionate, intimate, and devoted', icon: '💕', traits: ['Romantic', 'Devoted', 'Sensual'] },
  { id: 'magician', name: 'The Magician', description: 'Transformative, visionary, and inspiring', icon: '✨', traits: ['Inspiring', 'Mystical', 'Transformative'] },
  { id: 'ruler', name: 'The Ruler', description: 'Confident, authoritative, and organized', icon: '👑', traits: ['Decisive', 'Structured', 'Commanding'] },
  { id: 'everyperson', name: 'The Everyperson', description: 'Relatable, down-to-earth, and friendly', icon: '🤝', traits: ['Authentic', 'Approachable', 'Grounded'] },
  { id: 'innocent', name: 'The Innocent', description: 'Optimistic, pure, and hopeful', icon: '🌸', traits: ['Optimistic', 'Trusting', 'Joyful'] },
  { id: 'rebel', name: 'The Rebel', description: 'Unconventional, bold, and independent', icon: '🔥', traits: ['Defiant', 'Edgy', 'Authentic'] },
] as const;

type Archetype = typeof ARCHETYPES[number];

// Appearance options (use hyphenated values to match the type)
const ETHNICITIES = ['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed'] as const;
const BODY_TYPES = ['slim', 'athletic', 'curvy', 'plus-size'] as const;
const HAIR_COLORS = ['black', 'brown', 'blonde', 'red', 'fantasy'] as const;
const ART_STYLES = ['realistic', 'anime', 'stylized', 'abstract', 'minimal'] as const;

// Randomization helpers
const randomFrom = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomRange = (min: number, max: number): number => min + Math.random() * (max - min);

// Loading messages for the creation screen
const LOADING_MESSAGES = [
  'Choosing personality traits...',
  'Selecting appearance...',
  'Finding the perfect voice...',
  'Writing backstory...',
  'Bringing your companion to life...',
];

// Quick-start schema - minimal validation
const quickStartSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(30, 'Name must be 30 characters or less'),
});

type QuickStartFormValues = z.infer<typeof quickStartSchema>;

// Available voices for random selection
const availableVoices: VoiceOption[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, warm', sampleUrl: '', gender: 'feminine' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Calm, soothing', sampleUrl: '', gender: 'feminine' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Elegant, confident', sampleUrl: '', gender: 'feminine' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Sweet, youthful', sampleUrl: '', gender: 'feminine' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', description: 'Expressive, friendly', sampleUrl: '', gender: 'feminine' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep, resonant', sampleUrl: '', gender: 'masculine' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', description: 'Smooth, charming', sampleUrl: '', gender: 'masculine' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', description: 'Warm, intimate', sampleUrl: '', gender: 'masculine' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Rich, thoughtful', sampleUrl: '', gender: 'masculine' },
];

// Generate a fully randomized companion
const generateRandomCompanion = () => {
  // Random archetypes (primary required, secondary 50% chance)
  const primaryArchetype = randomFrom(ARCHETYPES);
  const otherArchetypes = ARCHETYPES.filter(a => a.id !== primaryArchetype.id);
  const secondaryArchetype = Math.random() > 0.5 ? randomFrom(otherArchetypes) : null;

  // Random personality with varied ranges (not all 0.5)
  const personality = {
    warmth: randomRange(0.3, 0.9),
    energy: randomRange(0.2, 0.9),
    playfulness: randomRange(0.3, 0.8),
    formality: randomRange(0.2, 0.7),
    assertiveness: randomRange(0.3, 0.8),
    curiosity: randomRange(0.4, 0.9),
    empathy: randomRange(0.4, 0.9),
    spontaneity: randomRange(0.3, 0.8),
    optimism: randomRange(0.4, 0.9),
    directness: randomRange(0.3, 0.8),
  };

  // Random appearance
  const visualStyle = {
    style_type: randomFrom(ART_STYLES),
    appearance: {
      ethnicity: randomFrom(ETHNICITIES),
      bodyType: randomFrom(BODY_TYPES),
      hairColor: randomFrom(HAIR_COLORS),
      breastSize: Math.floor(Math.random() * 100),
    },
  };

  // Random voice
  const voice = randomFrom(availableVoices);

  // Default boundaries
  const boundaries = {
    relationship_pacing: 'moderate',
    content_rating: 'R',
    emotional_depth: 'moderate' as const,
    topics_avoid: [] as string[],
    safe_topics: [] as string[],
  };

  return {
    primaryArchetype,
    secondaryArchetype,
    personality,
    visualStyle,
    voice,
    boundaries,
  };
};

interface QuickStartProps {
  onBack?: () => void;
}

export function QuickStart({ onBack }: QuickStartProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<'name' | 'creating'>('name');
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [generatedCompanion, setGeneratedCompanion] = useState<ReturnType<typeof generateRandomCompanion> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<QuickStartFormValues>({
    resolver: zodResolver(quickStartSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
    },
  });

  const companionName = watch('name');

  // Focus name input on mount
  useEffect(() => {
    if (step === 'name') {
      nameInputRef.current?.focus();
    }
  }, [step]);

  // Handle name submission - go straight to creating
  const onNameSubmit = useCallback(async () => {
    if (!isValid || !companionName) return;

    // Generate random companion and start creation
    const randomCompanion = generateRandomCompanion();
    setGeneratedCompanion(randomCompanion);
    setStep('creating');
    setIsCreating(true);
    setCreationProgress(10);
    setLoadingMessage(LOADING_MESSAGES[0]);

    // Cycle through loading messages
    const messageInterval = setInterval(() => {
      setLoadingMessage((prev) => {
        const currentIndex = LOADING_MESSAGES.indexOf(prev);
        const nextIndex = (currentIndex + 1) % LOADING_MESSAGES.length;
        return LOADING_MESSAGES[nextIndex];
      });
    }, 1200);

    try {
      // Progress: Generating personality
      setCreationProgress(20);
      await new Promise((r) => setTimeout(r, 400));

      // Build personality description from random values
      const personalityDescription = [
        randomCompanion.primaryArchetype.description,
        randomCompanion.secondaryArchetype
          ? `Secondary archetype: ${randomCompanion.secondaryArchetype.name}`
          : '',
        `Traits: ${randomCompanion.primaryArchetype.traits.join(', ')}`,
        `Warmth: ${Math.round(randomCompanion.personality.warmth * 100)}%`,
        `Playfulness: ${Math.round(randomCompanion.personality.playfulness * 100)}%`,
        `Empathy: ${Math.round(randomCompanion.personality.empathy * 100)}%`,
        `Energy: ${Math.round(randomCompanion.personality.energy * 100)}%`,
      ].filter(Boolean).join('\n');

      setCreationProgress(40);

      // Create the companion with random values
      const companion = await createCompanion({
        name: companionName,
        description: randomCompanion.primaryArchetype.description,
        personality: personalityDescription,
        voiceId: randomCompanion.voice.id,
        isPublic: false,
        spec: {
          identity: {
            name: companionName,
            pronouns: 'they/them', // Default neutral pronouns
          },
          personality: {
            archetype: randomCompanion.primaryArchetype.id,
            secondary_archetype: randomCompanion.secondaryArchetype?.id,
            traits: randomCompanion.personality,
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: randomCompanion.voice.id,
          },
          visual_style: randomCompanion.visualStyle,
          boundaries: randomCompanion.boundaries,
        },
      });

      setCreationProgress(60);

      // Fire off backstory generation in background (don't await)
      generateBackstory(companion.id, {
        archetype: randomCompanion.primaryArchetype.id,
        secondaryArchetype: randomCompanion.secondaryArchetype?.id,
        archetypeDescription: randomCompanion.primaryArchetype.description,
        personality: randomCompanion.personality,
        tenets: [],
      }).catch((err) => console.error('Backstory generation failed:', err));

      setCreationProgress(80);

      // Create a session
      const session = await createSession({
        companionId: companion.id,
        title: `Chat with ${companionName}`,
      });

      setCreationProgress(100);
      clearInterval(messageInterval);
      setLoadingMessage('Bringing your companion to life...');

      // Brief pause to show completion
      await new Promise((r) => setTimeout(r, 600));

      // Redirect to chat
      router.push(`/chat/${session.id}`);
    } catch (error) {
      clearInterval(messageInterval);
      console.error('Quick start creation failed:', error);
      toast({
        title: 'Creation failed',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
      setIsCreating(false);
      setStep('name');
    }
  }, [isValid, companionName, router, toast]);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {/* Step 1: Name */}
        {step === 'name' && (
          <motion.div
            key="name-step"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8"
          >
            <div className="text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 0.2 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-vibes-cyan/20 to-vibes-neon/20 border border-vibes-cyan/30 mb-2"
              >
                <Zap className="h-8 w-8 text-vibes-cyan" />
              </motion.div>
              <h2 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-white">
                Quick Start
              </h2>
              <p className="text-gray-400 max-w-md mx-auto">
                Create a companion in 60 seconds. You can customize everything later.
              </p>
            </div>

            <form onSubmit={handleSubmit(onNameSubmit)} className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
                  What should we call your companion?
                </label>
                <Input
                  {...register('name')}
                  ref={(e) => {
                    register('name').ref(e);
                    (nameInputRef as React.MutableRefObject<HTMLInputElement | null>).current = e;
                  }}
                  placeholder="Enter a name..."
                  className="bg-white/[0.03] border-white/10 h-16 text-xl focus:ring-vibes-cyan focus:border-vibes-cyan font-sans transition-all text-center"
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isValid) {
                      e.preventDefault();
                      onNameSubmit();
                    }
                  }}
                />
                {errors.name && (
                  <p className="text-sm text-vibes-hot font-medium text-center">{errors.name.message}</p>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                {onBack && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={onBack}
                    className="h-14 px-6 rounded-xl border border-white/10 hover:bg-white/5"
                  >
                    Back
                  </Button>
                )}
                <Button
                  type="submit"
                  size="lg"
                  disabled={!isValid || isCreating}
                  className="flex-1 h-14 rounded-xl bg-gradient-to-r from-vibes-cyan to-vibes-neon hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg disabled:opacity-50"
                >
                  <Sparkles className="mr-2 h-5 w-5" />
                  Create Companion
                </Button>
              </div>
            </form>
          </motion.div>
        )}

        {/* Step 2: Creating */}
        {step === 'creating' && (
          <motion.div
            key="creating-step"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-vibes-neon/20 via-vibes-hot/20 to-vibes-cyan/20 border border-white/10"
            >
              {creationProgress < 100 ? (
                <Loader2 className="h-12 w-12 text-vibes-neon animate-spin" />
              ) : (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                >
                  <CheckCircle2 className="h-12 w-12 text-vibes-cyan" />
                </motion.div>
              )}
            </motion.div>

            <div className="space-y-2">
              <h2 className="text-2xl md:text-3xl font-bold font-display text-white">
                {creationProgress < 100 ? (
                  <>
                    Creating <span className="text-vibes-neon">{companionName}</span>...
                  </>
                ) : (
                  <>
                    <span className="text-vibes-cyan">{companionName}</span> is ready!
                  </>
                )}
              </h2>
              <motion.p
                key={loadingMessage}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-gray-400"
              >
                {creationProgress >= 100 ? 'Launching conversation...' : loadingMessage}
              </motion.p>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-xs mx-auto">
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-vibes-cyan via-vibes-neon to-vibes-hot"
                  initial={{ width: 0 }}
                  animate={{ width: `${creationProgress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Generated archetype display */}
            {generatedCompanion && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="flex items-center justify-center gap-3 text-sm text-gray-400"
              >
                <span className="text-2xl">{generatedCompanion.primaryArchetype.icon}</span>
                <span>{generatedCompanion.primaryArchetype.name}</span>
                {generatedCompanion.secondaryArchetype && (
                  <>
                    <span className="text-gray-600">+</span>
                    <span className="text-2xl">{generatedCompanion.secondaryArchetype.icon}</span>
                  </>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tip at bottom */}
      {step !== 'creating' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 flex items-center justify-center gap-2 text-xs text-gray-500"
        >
          <Info className="h-3.5 w-3.5" />
          <span>You can customize your companion anytime from the dashboard</span>
        </motion.div>
      )}
    </div>
  );
}
