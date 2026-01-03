'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore, type VoiceOption, type AppearanceEthnicity, type AppearanceBodyType, type AppearanceHairColor, type CompanionArchetype } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateRandomIdentity, createCompanion } from '@/lib/api/companions';
import { streamAnchorImages } from '@/lib/api/imagegen';

// All 12 archetypes for random selection
const ARCHETYPES: CompanionArchetype[] = [
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
];

// Appearance options
const ETHNICITIES: AppearanceEthnicity[] = ['east-asian', 'south-asian', 'black', 'caucasian', 'latina', 'middle-eastern', 'mixed'];
const BODY_TYPES: AppearanceBodyType[] = ['slim', 'athletic', 'curvy', 'plus-size'];
const HAIR_COLORS: AppearanceHairColor[] = ['black', 'brown', 'blonde', 'red', 'fantasy'];
const ART_STYLES = ['realistic', 'anime', 'stylized', 'abstract', 'minimal'] as const;

// Available voices
const VOICES: VoiceOption[] = [
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

// Randomization helpers
const randomFrom = <T,>(arr: readonly T[] | T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomRange = (min: number, max: number): number => Math.round(min + Math.random() * (max - min));

// Generate full companion attributes
function generateFullCompanion() {
  const primaryArchetype = randomFrom(ARCHETYPES);
  const otherArchetypes = ARCHETYPES.filter(a => a.id !== primaryArchetype.id);
  const secondaryArchetype = Math.random() > 0.5 ? randomFrom(otherArchetypes) : null;

  const personality = {
    warmth: randomRange(30, 90),
    energy: randomRange(20, 90),
    playfulness: randomRange(30, 80),
    formality: randomRange(20, 70),
    assertiveness: randomRange(30, 80),
    curiosity: randomRange(40, 90),
    empathy: randomRange(40, 90),
    spontaneity: randomRange(30, 80),
    optimism: randomRange(40, 90),
    directness: randomRange(30, 80),
  };

  const visualStyle = {
    avatarStyle: randomFrom(ART_STYLES),
    appearance: {
      ethnicity: randomFrom(ETHNICITIES),
      bodyType: randomFrom(BODY_TYPES),
      hairColor: randomFrom(HAIR_COLORS),
      breastSize: Math.floor(Math.random() * 100),
    },
    colorTheme: 'campfire',
    animationLevel: 'moderate' as const,
  };

  const voice = randomFrom(VOICES);

  return {
    primaryArchetype,
    secondaryArchetype,
    personality,
    visualStyle,
    voice,
  };
}

const identitySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  pronouns: z.string().min(1, 'Please select or enter pronouns'),
  backstory: z.string().optional(),
});

type IdentityFormValues = z.infer<typeof identitySchema>;

export function Step2Identity() {
  const store = useOnboardingStore();
  const {
    name,
    identity,
    setName,
    setIdentity,
    nextStep,
    setArchetype,
    setSecondaryArchetype,
    setPersonality,
    setVisualStyle,
    setVoice,
    setCompanionId,
    setGenerationStarted,
    addAnchorImage,
    setAnchorImagesComplete,
  } = store;
  const [isGenerating, setIsGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<IdentityFormValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      name,
      pronouns: identity.pronouns,
      backstory: identity.backstory,
    },
    mode: 'onChange',
  });

  const onSubmit = (data: IdentityFormValues) => {
    setName(data.name);
    setIdentity({
      pronouns: data.pronouns,
      backstory: data.backstory || '',
    });
    nextStep();
  };

  const handleSurpriseMe = async () => {
    setIsGenerating(true);
    setJustGenerated(false);
    try {
      // Generate identity (name, pronouns, backstory)
      const generated = await generateRandomIdentity();
      setValue('name', generated.name, { shouldValidate: true });
      setValue('pronouns', generated.pronouns, { shouldValidate: true });
      setValue('backstory', generated.backstory, { shouldValidate: true });

      // Generate full companion attributes
      const fullCompanion = generateFullCompanion();

      // Store all generated attributes in the onboarding store
      setArchetype(fullCompanion.primaryArchetype);
      setSecondaryArchetype(fullCompanion.secondaryArchetype);
      setPersonality(fullCompanion.personality);
      setVisualStyle(fullCompanion.visualStyle);
      setVoice(fullCompanion.voice);

      // Create companion via API to get companionId
      const personalityDescription = [
        fullCompanion.primaryArchetype.description,
        fullCompanion.secondaryArchetype
          ? `Secondary archetype: ${fullCompanion.secondaryArchetype.name}`
          : '',
        `Traits: ${fullCompanion.primaryArchetype.traits.join(', ')}`,
      ].filter(Boolean).join('\n');

      const companion = await createCompanion({
        name: generated.name,
        description: fullCompanion.primaryArchetype.description,
        personality: personalityDescription,
        voiceId: fullCompanion.voice.id,
        isPublic: false,
        spec: {
          identity: {
            name: generated.name,
            pronouns: generated.pronouns,
            backstory: generated.backstory,
          },
          personality: {
            archetype: fullCompanion.primaryArchetype.id,
            secondary_archetype: fullCompanion.secondaryArchetype?.id,
            traits: fullCompanion.personality,
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: fullCompanion.voice.id,
          },
          visual_style: {
            style_type: fullCompanion.visualStyle.avatarStyle,
            appearance: fullCompanion.visualStyle.appearance,
          },
        },
      });

      // Store companion ID and mark generation as started
      setCompanionId(companion.id);
      setGenerationStarted(true);

      // Start streaming anchor images in the background
      console.log('[SurpriseMe] Starting anchor image generation for companion:', companion.id);
      streamAnchorImages(
        {
          companionId: companion.id,
          appearance: {
            ethnicity: fullCompanion.visualStyle.appearance.ethnicity,
            bodyType: fullCompanion.visualStyle.appearance.bodyType,
            hairColor: fullCompanion.visualStyle.appearance.hairColor,
            breastSize: fullCompanion.visualStyle.appearance.breastSize,
          },
          style: fullCompanion.visualStyle.avatarStyle,
          personality: {
            warmth: fullCompanion.personality.warmth,
            playfulness: fullCompanion.personality.playfulness,
            directness: fullCompanion.personality.directness,
            curiosity: fullCompanion.personality.curiosity,
            empathy: fullCompanion.personality.empathy,
            assertiveness: fullCompanion.personality.assertiveness,
          },
        },
        {
          onProgress: (data) => {
            console.log('[SurpriseMe] Anchor progress:', data);
          },
          onAnchor: (anchor) => {
            console.log('[SurpriseMe] Anchor received:', anchor);
            addAnchorImage(anchor);
          },
          onComplete: (result) => {
            console.log('[SurpriseMe] Anchor generation complete:', result);
            setAnchorImagesComplete(true);
          },
          onError: (error) => {
            console.error('[SurpriseMe] Anchor generation error:', error);
            // Still mark as complete so we can proceed with any partial results
            setAnchorImagesComplete(true);
          },
        }
      );

      setJustGenerated(true);
      setHasGenerated(true);
      // Reset the animation trigger after a delay
      setTimeout(() => setJustGenerated(false), 1500);
    } catch (error) {
      console.error('Failed to generate identity:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Animation for individual inputs when generated - background color sweep
  const getInputAnimation = (delay: number) => ({
    background: [
      'rgba(255, 255, 255, 0.03)',
      'rgba(168, 85, 247, 0.15)',
      'rgba(6, 182, 212, 0.1)',
      'rgba(255, 255, 255, 0.03)',
    ],
    transition: {
      duration: 1.2,
      delay,
      ease: 'easeInOut',
    },
  });

  return (
    <Card className="w-full bg-white/[0.01] backdrop-blur-3xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
      <CardHeader className="space-y-2 pb-6">
        <div>
          <CardTitle className="text-3xl font-bold font-display tracking-tight text-white">Identity</CardTitle>
          <CardDescription className="text-gray-400 mt-2">
            Give your companion a name and identity — or let fate decide.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Surprise Me Button + Next Button after generation */}
          <div className="flex gap-3">
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1"
              layout
            >
              <Button
                type="button"
                size="lg"
                onClick={handleSurpriseMe}
                disabled={isGenerating}
                className={cn(
                  "relative w-full h-16 rounded-2xl font-bold text-lg transition-all duration-400 overflow-hidden group",
                  hasGenerated && !isGenerating
                    ? "bg-transparent border border-white/20 text-gray-400 hover:border-white/40 hover:text-gray-300 shadow-none"
                    : "bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-cyan text-white shadow-[0_0_30px_rgba(168,85,247,0.3)] hover:shadow-[0_0_50px_rgba(168,85,247,0.5)]"
                )}
              >
                {/* Animated shimmer effect - only show when not generated */}
                {!hasGenerated && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    initial={{ x: '-100%' }}
                    animate={isGenerating ? { x: '100%' } : { x: '-100%' }}
                    transition={isGenerating ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
                  />
                )}

                <span className="relative flex items-center justify-center gap-3">
                  {isGenerating ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      >
                        <Sparkles className="h-6 w-6" />
                      </motion.div>
                      Conjuring...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-6 w-6 group-hover:rotate-12 transition-transform" />
                      Surprise Me
                    </>
                  )}
                </span>
              </Button>
            </motion.div>

            <AnimatePresence>
              {hasGenerated && !isGenerating && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: 'auto' }}
                  exit={{ opacity: 0, scale: 0.8, width: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  <Button
                    type="submit"
                    size="lg"
                    className="group h-16 px-8 rounded-2xl bg-gradient-to-r from-vibes-electric to-vibes-cyan hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg whitespace-nowrap"
                  >
                    Next: Visuals
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <span className="text-xs font-bold tracking-widest uppercase text-gray-500">or customize</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>

          <div className="space-y-3">
            <Label htmlFor="name" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Name
            </Label>
            <motion.div
              animate={justGenerated ? getInputAnimation(0) : {}}
              className="rounded-lg"
            >
              <Input
                id="name"
                placeholder="e.g. Atlas, Luna, Jarvis..."
                {...register('name')}
                className="bg-white/[0.03] border-white/10 h-14 md:h-16 text-lg md:text-xl focus:ring-vibes-neon focus:border-vibes-neon font-sans transition-all"
              />
            </motion.div>
            {errors.name && (
              <p className="text-sm text-vibes-hot font-medium">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="pronouns" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Pronouns
            </Label>
            <motion.div
              animate={justGenerated ? getInputAnimation(0.15) : {}}
              className="rounded-lg"
            >
              <Input
                id="pronouns"
                placeholder="e.g. they/them, she/her..."
                {...register('pronouns')}
                className="bg-white/[0.03] border-white/10 h-14 md:h-16 text-lg md:text-xl focus:ring-vibes-cyan focus:border-vibes-cyan transition-all"
              />
            </motion.div>
            {errors.pronouns && (
              <p className="text-sm text-vibes-hot font-medium">{errors.pronouns.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="backstory" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Backstory (Optional)
            </Label>
            <motion.div
              animate={justGenerated ? getInputAnimation(0.3) : {}}
              className="rounded-lg"
            >
              <Textarea
                id="backstory"
                placeholder="Briefly describe who they are... (e.g. A digital librarian from the 22nd century)"
                {...register('backstory')}
                className="min-h-[120px] md:min-h-[180px] lg:min-h-[220px] bg-white/[0.03] border-white/10 text-lg md:text-xl focus:ring-vibes-electric focus:border-vibes-electric transition-all scrollbar-subtle"
              />
            </motion.div>
          </div>

          <AnimatePresence>
            {!hasGenerated && (
              <motion.div
                className="pt-6 flex justify-end"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!isValid}
                    className="group h-14 px-10 rounded-full bg-gradient-to-r from-vibes-electric to-vibes-cyan hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg"
                  >
                    Next: Visuals
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </CardContent>
    </Card>
  );
}
