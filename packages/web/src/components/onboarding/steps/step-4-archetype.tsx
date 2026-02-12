'use client';

import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { trackOnboardingStep } from '@/lib/analytics/meta-pixel';

/**
 * All 12 archetypes from the shared personality schema
 */
const archetypes = [
  {
    id: 'caregiver',
    name: 'The Caregiver',
    description: 'Nurturing, supportive, and empathetic',
    icon: '🤗',
    traits: ['Compassionate', 'Patient', 'Protective'],
  },
  {
    id: 'sage',
    name: 'The Sage',
    description: 'Wise, thoughtful, and philosophical',
    icon: '🦉',
    traits: ['Knowledgeable', 'Reflective', 'Objective'],
  },
  {
    id: 'explorer',
    name: 'The Explorer',
    description: 'Curious, adventurous, and open-minded',
    icon: '🧭',
    traits: ['Curious', 'Bold', 'Independent'],
  },
  {
    id: 'creator',
    name: 'The Creator',
    description: 'Imaginative, expressive, and artistic',
    icon: '🎨',
    traits: ['Creative', 'Visionary', 'Expressive'],
  },
  {
    id: 'hero',
    name: 'The Hero',
    description: 'Brave, determined, and protective',
    icon: '⚔️',
    traits: ['Courageous', 'Driven', 'Honorable'],
  },
  {
    id: 'jester',
    name: 'The Jester',
    description: 'Playful, humorous, and lighthearted',
    icon: '🎭',
    traits: ['Witty', 'Fun', 'Spontaneous'],
  },
  {
    id: 'lover',
    name: 'The Lover',
    description: 'Passionate, intimate, and devoted',
    icon: '💕',
    traits: ['Romantic', 'Devoted', 'Sensual'],
  },
  {
    id: 'magician',
    name: 'The Magician',
    description: 'Transformative, visionary, and inspiring',
    icon: '✨',
    traits: ['Inspiring', 'Mystical', 'Transformative'],
  },
  {
    id: 'ruler',
    name: 'The Ruler',
    description: 'Confident, authoritative, and organized',
    icon: '👑',
    traits: ['Decisive', 'Structured', 'Commanding'],
  },
  {
    id: 'everyperson',
    name: 'The Everyperson',
    description: 'Relatable, down-to-earth, and friendly',
    icon: '🤝',
    traits: ['Authentic', 'Approachable', 'Grounded'],
  },
  {
    id: 'innocent',
    name: 'The Innocent',
    description: 'Optimistic, pure, and hopeful',
    icon: '🌸',
    traits: ['Optimistic', 'Trusting', 'Joyful'],
  },
  {
    id: 'rebel',
    name: 'The Rebel',
    description: 'Unconventional, bold, and independent',
    icon: '🔥',
    traits: ['Defiant', 'Edgy', 'Authentic'],
  },
];

export function Step4Archetype() {
  const { archetype, secondaryArchetype, setArchetype, setSecondaryArchetype, nextStep } =
    useOnboardingStore();
  const [isSurprising, setIsSurprising] = useState(false);
  const [highlightedPrimary, setHighlightedPrimary] = useState<string | null>(null);
  const [highlightedSecondary, setHighlightedSecondary] = useState<string | null>(null);
  const hasTrackedRef = useRef(false);

  // Track step on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      trackOnboardingStep(4, 'archetype', 'full');
      hasTrackedRef.current = true;
    }
  }, []);

  const handleSurpriseMe = useCallback(async () => {
    setIsSurprising(true);

    // Pick random archetypes
    const primaryIndex = Math.floor(Math.random() * archetypes.length);
    const remainingIndices = archetypes
      .map((_, i) => i)
      .filter((i) => i !== primaryIndex);
    const secondaryIndex = remainingIndices[Math.floor(Math.random() * remainingIndices.length)];

    const targetPrimary = archetypes[primaryIndex];
    const targetSecondary = archetypes[secondaryIndex];

    // Animate through primary archetypes rapidly
    const primarySteps = 12;
    for (let i = 0; i < primarySteps; i++) {
      const randomIndex = Math.floor(Math.random() * archetypes.length);
      setHighlightedPrimary(archetypes[randomIndex].id);
      await new Promise((r) => setTimeout(r, 60 + i * 8)); // Speed up then slow down
    }
    // Land on the target primary
    setHighlightedPrimary(targetPrimary.id);
    setArchetype(targetPrimary);

    // Small pause before secondary animation
    await new Promise((r) => setTimeout(r, 200));

    // Animate through secondary archetypes
    const secondarySteps = 8;
    for (let i = 0; i < secondarySteps; i++) {
      const randomIndex = Math.floor(Math.random() * archetypes.length);
      if (archetypes[randomIndex].id !== targetPrimary.id) {
        setHighlightedSecondary(archetypes[randomIndex].id);
      }
      await new Promise((r) => setTimeout(r, 80 + i * 12));
    }
    // Land on the target secondary
    setHighlightedSecondary(targetSecondary.id);
    setSecondaryArchetype(targetSecondary);

    // Wait a moment to show the selection, then proceed
    await new Promise((r) => setTimeout(r, 600));
    setIsSurprising(false);
    setHighlightedPrimary(null);
    setHighlightedSecondary(null);
    nextStep();
  }, [setArchetype, setSecondaryArchetype, nextStep]);

  const handlePrimaryKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, archetypeId: string) => {
    if (isSurprising) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const selected = archetypes.find((type) => type.id === archetypeId);
      if (selected) {
        setArchetype(selected);
      }
    }
  }, [isSurprising, setArchetype]);

  const handleSecondaryKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, archetypeId: string) => {
    if (isSurprising) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const selected = archetypes.find((type) => type.id === archetypeId);
      if (selected) {
        setSecondaryArchetype(secondaryArchetype?.id === selected.id ? null : selected);
      }
    }
  }, [isSurprising, secondaryArchetype?.id, setSecondaryArchetype]);

  return (
    <div className="space-y-8">
      <div className="text-left md:text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">
          Choose your archetype
        </h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Select a primary personality archetype for your companion, and optionally a secondary one
          for blending.
        </p>
      </div>

      {/* Surprise Me - centered above archetypes */}
      <div className="flex justify-center">
        <Button
          size="lg"
          disabled={isSurprising}
          onClick={handleSurpriseMe}
          className="group w-full md:w-auto h-16 px-12 rounded-2xl bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-cyan text-white shadow-[0_0_30px_rgba(168,85,247,0.3)] hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all font-bold text-lg relative overflow-hidden"
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            initial={{ x: '-100%' }}
            animate={isSurprising ? { x: '100%' } : { x: '-100%' }}
            transition={isSurprising ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
          />
          <span className="relative flex items-center">
            {isSurprising ? (
              <Sparkles className="mr-2 h-6 w-6 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-6 w-6 group-hover:rotate-12 transition-transform" />
            )}
            {isSurprising ? 'Choosing...' : 'Surprise Me'}
          </span>
        </Button>
      </div>

      {/* Primary Archetype Selection */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
          Primary Archetype
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {archetypes.map((type) => {
            const isHighlighted = highlightedPrimary === type.id;
            const isSelected = archetype?.id === type.id;
            return (
            <motion.div
              key={type.id}
              whileHover={isSurprising ? {} : { scale: 1.02 }}
              whileTap={isSurprising ? {} : { scale: 0.98 }}
              animate={isHighlighted ? {
                scale: [1, 1.08, 1.05],
                transition: { duration: 0.15 }
              } : {}}
            >
              <Card
                role="button"
                tabIndex={isSurprising ? -1 : 0}
                aria-pressed={isSelected}
                aria-label={`Select primary archetype ${type.name}`}
                className={cn(
                  'cursor-pointer transition-all border-white/10 h-full',
                  isHighlighted
                    ? 'bg-vibes-neon/20 border-vibes-neon ring-2 ring-vibes-neon shadow-[0_0_30px_rgba(168,85,247,0.4)]'
                    : isSelected
                    ? 'bg-white/[0.08] border-vibes-neon/50 ring-1 ring-vibes-neon/30 shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                    : 'bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/20'
                )}
                onClick={() => !isSurprising && setArchetype(type)}
                onKeyDown={(event) => handlePrimaryKeyDown(event, type.id)}
              >
                <CardContent className="p-4">
                  <div className="text-3xl mb-2 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                    {type.icon}
                  </div>
                  <CardTitle className="text-sm font-bold text-white mb-1">{type.name}</CardTitle>
                  <CardDescription className="text-xs text-gray-500 line-clamp-2">
                    {type.description}
                  </CardDescription>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {type.traits.map((trait) => (
                      <span
                        key={trait}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400"
                      >
                        {trait}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
          })}
        </div>
      </div>

      {/* Secondary Archetype Selection (optional) */}
      <AnimatePresence>
        {archetype && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-vibes-cyan" />
              <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
                Secondary Archetype
              </h3>
              <span className="text-xs text-gray-600">(Optional - for personality blending)</span>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {archetypes
                .filter((t) => t.id !== archetype.id)
                .map((type) => {
                  const isHighlighted = highlightedSecondary === type.id;
                  const isSelected = secondaryArchetype?.id === type.id;
                  return (
                  <motion.div
                    key={type.id}
                    whileHover={isSurprising ? {} : { scale: 1.02 }}
                    whileTap={isSurprising ? {} : { scale: 0.98 }}
                    animate={isHighlighted ? {
                      scale: [1, 1.1, 1.05],
                      transition: { duration: 0.12 }
                    } : {}}
                  >
                    <Card
                      role="button"
                      tabIndex={isSurprising ? -1 : 0}
                      aria-pressed={isSelected}
                      aria-label={`Select secondary archetype ${type.name}`}
                      className={cn(
                        'cursor-pointer transition-all border-white/10',
                        isHighlighted
                          ? 'bg-vibes-cyan/20 border-vibes-cyan ring-2 ring-vibes-cyan shadow-[0_0_25px_rgba(6,182,212,0.4)]'
                          : isSelected
                          ? 'bg-white/[0.06] border-vibes-cyan/50 ring-1 ring-vibes-cyan/30'
                          : 'bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/20'
                      )}
                      onClick={() =>
                        !isSurprising && setSecondaryArchetype(
                          secondaryArchetype?.id === type.id ? null : type
                        )
                      }
                      onKeyDown={(event) => handleSecondaryKeyDown(event, type.id)}
                    >
                      <CardContent className="p-3 text-center">
                        <div className="text-xl">{type.icon}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          {type.name.replace('The ', '')}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
                })}
            </div>
            {secondaryArchetype && (
              <p className="text-xs text-gray-500 text-center">
                Your companion will blend{' '}
                <span className="text-vibes-neon">{archetype.name}</span> with{' '}
                <span className="text-vibes-cyan">{secondaryArchetype.name}</span> traits
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-end pt-4">
        <Button
          size="lg"
          disabled={!archetype || isSurprising}
          onClick={nextStep}
          className="group h-16 px-14 rounded-full bg-gradient-to-r from-vibes-neon to-vibes-hot hover:shadow-[0_0_30px_rgba(236,72,153,0.3)] transition-all font-bold text-xl disabled:opacity-50"
        >
          Next: Voice
          <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
