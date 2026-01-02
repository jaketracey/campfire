'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// All 12 archetypes from the personality schema
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

interface ArchetypeDisplayProps {
  primaryArchetypeId: string;
  secondaryArchetypeId: string | null;
  onComplete: () => void;
}

export function ArchetypeDisplay({
  primaryArchetypeId,
  secondaryArchetypeId,
  onComplete,
}: ArchetypeDisplayProps) {
  const [showPrimary, setShowPrimary] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);

  const primaryArchetype = archetypes.find((a) => a.id === primaryArchetypeId);
  const secondaryArchetype = secondaryArchetypeId
    ? archetypes.find((a) => a.id === secondaryArchetypeId)
    : null;

  useEffect(() => {
    const timers = [
      setTimeout(() => setShowPrimary(true), 300),
      setTimeout(() => setShowSecondary(true), 800),
      setTimeout(onComplete, 1400),
    ];

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">
          Choose Your Archetype
        </h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Select a primary personality archetype for your companion
        </p>
      </div>

      {/* Primary Archetype Grid */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
          Primary Archetype
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {archetypes.map((type) => {
            const isPrimary = type.id === primaryArchetypeId;
            return (
              <motion.div
                key={type.id}
                initial={{ opacity: 0.5, scale: 0.98 }}
                animate={showPrimary && isPrimary ? {
                  opacity: 1,
                  scale: [1, 1.08, 1.04],
                } : { opacity: 0.5, scale: 1 }}
                transition={{ duration: 0.25 }}
              >
                <Card
                  className={cn(
                    'transition-all border-white/10 h-full',
                    showPrimary && isPrimary
                      ? 'bg-vibes-neon/20 border-vibes-neon ring-2 ring-vibes-neon shadow-[0_0_30px_rgba(168,85,247,0.4)]'
                      : 'bg-white/[0.01]'
                  )}
                >
                  <CardContent className="p-3">
                    <div className="text-2xl mb-1.5 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                      {type.icon}
                    </div>
                    <CardTitle className="text-xs font-bold text-white mb-0.5">{type.name}</CardTitle>
                    <CardDescription className="text-[10px] text-gray-500 line-clamp-2">
                      {type.description}
                    </CardDescription>
                    <div className="flex flex-wrap gap-0.5 mt-1.5">
                      {type.traits.map((trait) => (
                        <span
                          key={trait}
                          className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-gray-400"
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

      {/* Secondary Archetype */}
      {secondaryArchetype && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-vibes-cyan" />
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
              Secondary Archetype
            </h3>
            <span className="text-xs text-gray-600">(For personality blending)</span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {archetypes
              .filter((t) => t.id !== primaryArchetypeId)
              .map((type) => {
                const isSecondary = type.id === secondaryArchetypeId;
                return (
                  <motion.div
                    key={type.id}
                    initial={{ opacity: 0.4 }}
                    animate={showSecondary && isSecondary ? {
                      opacity: 1,
                      scale: [1, 1.12, 1.05],
                    } : { opacity: 0.4 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card
                      className={cn(
                        'transition-all border-white/10',
                        showSecondary && isSecondary
                          ? 'bg-vibes-cyan/20 border-vibes-cyan ring-2 ring-vibes-cyan shadow-[0_0_25px_rgba(6,182,212,0.4)]'
                          : 'bg-white/[0.01]'
                      )}
                    >
                      <CardContent className="p-2.5 text-center">
                        <div className="text-lg">{type.icon}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {type.name.replace('The ', '')}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
          </div>
          {showSecondary && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-gray-500 text-center"
            >
              Your companion will blend{' '}
              <span className="text-vibes-neon">{primaryArchetype?.name}</span> with{' '}
              <span className="text-vibes-cyan">{secondaryArchetype.name}</span> traits
            </motion.p>
          )}
        </motion.div>
      )}
    </div>
  );
}
