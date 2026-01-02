'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IdentityDisplay } from './quick-start/identity-display';
import { VisualsDisplay } from './quick-start/visuals-display';
import { ArchetypeDisplay } from './quick-start/archetype-display';
import { VoiceDisplay } from './quick-start/voice-display';
import type { AppearanceEthnicity, AppearanceBodyType, AppearanceHairColor } from '@/stores/onboarding-store';

type CarouselSection = 'identity' | 'visuals' | 'archetype' | 'voice';

const SECTIONS: CarouselSection[] = ['identity', 'visuals', 'archetype', 'voice'];
const SECTION_LABELS: Record<CarouselSection, string> = {
  identity: 'Identity',
  visuals: 'Visuals',
  archetype: 'Archetype',
  voice: 'Voice',
};

interface GeneratedCompanionData {
  primaryArchetype: {
    id: string;
    name: string;
    description: string;
    icon: string;
    traits: readonly string[];
  };
  secondaryArchetype: {
    id: string;
    name: string;
    description: string;
    icon: string;
    traits: readonly string[];
  } | null;
  personality: {
    warmth: number;
    energy: number;
    playfulness: number;
    formality: number;
    assertiveness: number;
    curiosity: number;
    empathy: number;
    spontaneity: number;
    optimism: number;
    directness: number;
  };
  visualStyle: {
    style_type: string;
    appearance: {
      ethnicity: AppearanceEthnicity;
      bodyType: AppearanceBodyType;
      hairColor: AppearanceHairColor;
      breastSize: number;
    };
  };
  voice: {
    id: string;
    name: string;
    description: string;
    gender: string;
  };
  boundaries: {
    relationship_pacing: string;
    content_rating: string;
    emotional_depth: string;
    topics_avoid: string[];
    safe_topics: string[];
  };
}

interface QuickStartCarouselProps {
  companionName: string;
  generatedData: GeneratedCompanionData;
  onComplete: () => void;
}

// Generate a random backstory snippet
function generateBackstorySnippet(archetype: string): string {
  const snippets: Record<string, string[]> = {
    caregiver: [
      'A gentle soul who finds joy in nurturing others through life\'s challenges.',
      'Devoted to helping others flourish, always ready with a warm embrace.',
    ],
    sage: [
      'A seeker of wisdom who delights in exploring life\'s deeper meanings.',
      'Thoughtful and reflective, finding peace in philosophical contemplation.',
    ],
    explorer: [
      'An adventurous spirit driven by insatiable curiosity about the world.',
      'Always seeking new horizons, finding excitement in the unknown.',
    ],
    creator: [
      'An artistic soul who sees beauty and possibility everywhere.',
      'Driven to create and express, turning imagination into reality.',
    ],
    hero: [
      'A brave heart who stands ready to face any challenge head-on.',
      'Courageous and determined, always fighting for what matters.',
    ],
    jester: [
      'A playful spirit who finds joy in laughter and lighthearted moments.',
      'Quick-witted and spontaneous, bringing smiles wherever they go.',
    ],
    lover: [
      'A passionate soul devoted to deep connection and intimacy.',
      'Romantic and sensual, savoring every moment of closeness.',
    ],
    magician: [
      'A transformative presence who inspires wonder and possibility.',
      'Mystical and visionary, making the impossible feel within reach.',
    ],
    ruler: [
      'A confident leader who brings order and structure to any situation.',
      'Decisive and authoritative, commanding respect effortlessly.',
    ],
    everyperson: [
      'A down-to-earth companion who values genuine connection.',
      'Authentic and approachable, making everyone feel at ease.',
    ],
    innocent: [
      'An optimistic soul who sees the best in every situation.',
      'Pure-hearted and joyful, bringing light to dark moments.',
    ],
    rebel: [
      'A free spirit who defies convention and blazes their own trail.',
      'Bold and unconventional, unafraid to challenge the status quo.',
    ],
  };

  const options = snippets[archetype] || snippets.everyperson;
  return options[Math.floor(Math.random() * options.length)];
}

export function QuickStartCarousel({
  companionName,
  generatedData,
  onComplete,
}: QuickStartCarouselProps) {
  const [currentSection, setCurrentSection] = useState<CarouselSection>('identity');
  const currentIndex = SECTIONS.indexOf(currentSection);
  const progress = ((currentIndex + 1) / SECTIONS.length) * 100;

  const backstory = generateBackstorySnippet(generatedData.primaryArchetype.id);

  const handleSectionComplete = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < SECTIONS.length) {
      setCurrentSection(SECTIONS[nextIndex]);
    } else {
      onComplete();
    }
  }, [currentIndex, onComplete]);

  const renderSection = () => {
    switch (currentSection) {
      case 'identity':
        return (
          <IdentityDisplay
            key="identity"
            name={companionName}
            pronouns="they/them"
            backstory={backstory}
            onComplete={handleSectionComplete}
          />
        );
      case 'visuals':
        return (
          <VisualsDisplay
            key="visuals"
            ethnicity={generatedData.visualStyle.appearance.ethnicity}
            bodyType={generatedData.visualStyle.appearance.bodyType}
            hairColor={generatedData.visualStyle.appearance.hairColor}
            breastSize={generatedData.visualStyle.appearance.breastSize}
            artStyle={generatedData.visualStyle.style_type}
            onComplete={handleSectionComplete}
          />
        );
      case 'archetype':
        return (
          <ArchetypeDisplay
            key="archetype"
            primaryArchetypeId={generatedData.primaryArchetype.id}
            secondaryArchetypeId={generatedData.secondaryArchetype?.id || null}
            onComplete={handleSectionComplete}
          />
        );
      case 'voice':
        return (
          <VoiceDisplay
            key="voice"
            voiceId={generatedData.voice.id}
            onComplete={handleSectionComplete}
          />
        );
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between gap-4 px-4">
        <div className="flex-1">
          <div className="flex justify-between mb-2">
            {SECTIONS.map((section, index) => (
              <span
                key={section}
                className={`text-[10px] font-bold tracking-widest uppercase transition-colors ${
                  index <= currentIndex ? 'text-vibes-cyan' : 'text-gray-600'
                }`}
              >
                {SECTION_LABELS[section]}
              </span>
            ))}
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
            <motion.div
              className="h-full bg-gradient-to-r from-vibes-electric to-vibes-cyan shadow-[0_0_10px_rgba(6,182,212,0.5)]"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {/* Section content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSection}
          initial={{ opacity: 0, x: 50, scale: 0.98, filter: 'blur(10px)' }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: -50, scale: 0.98, filter: 'blur(10px)' }}
          transition={{
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="relative z-10"
        >
          {renderSection()}
        </motion.div>
      </AnimatePresence>

      {/* Companion name badge */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex justify-center"
      >
        <div className="px-6 py-2 rounded-full bg-white/[0.03] border border-white/10">
          <span className="text-sm text-gray-400">Creating </span>
          <span className="text-sm font-bold text-vibes-neon">{companionName}</span>
        </div>
      </motion.div>
    </div>
  );
}
