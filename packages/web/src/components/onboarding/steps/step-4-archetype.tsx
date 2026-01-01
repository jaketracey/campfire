'use client';

import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

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

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">
          Choose Your Archetype
        </h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Select a primary personality archetype for your companion, and optionally a secondary one
          for blending.
        </p>
      </div>

      {/* Primary Archetype Selection */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
          Primary Archetype
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {archetypes.map((type) => (
            <motion.div
              key={type.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Card
                className={cn(
                  'cursor-pointer transition-all border-white/10 h-full',
                  archetype?.id === type.id
                    ? 'bg-white/[0.08] border-vibes-neon/50 ring-1 ring-vibes-neon/30 shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                    : 'bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/20'
                )}
                onClick={() => setArchetype(type)}
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
          ))}
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
                .map((type) => (
                  <motion.div
                    key={type.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Card
                      className={cn(
                        'cursor-pointer transition-all border-white/10',
                        secondaryArchetype?.id === type.id
                          ? 'bg-white/[0.06] border-vibes-cyan/50 ring-1 ring-vibes-cyan/30'
                          : 'bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/20'
                      )}
                      onClick={() =>
                        setSecondaryArchetype(
                          secondaryArchetype?.id === type.id ? null : type
                        )
                      }
                    >
                      <CardContent className="p-3 text-center">
                        <div className="text-xl">{type.icon}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          {type.name.replace('The ', '')}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
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
          disabled={!archetype}
          onClick={nextStep}
          className="group h-14 px-12 rounded-full bg-gradient-to-r from-vibes-neon to-vibes-hot hover:shadow-[0_0_30px_rgba(236,72,153,0.3)] transition-all font-bold text-lg disabled:opacity-50"
        >
          Next: Personality Traits
          <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
