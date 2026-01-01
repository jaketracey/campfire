'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { Sparkles, Heart, Zap, Brain, Sun, MessageCircle } from 'lucide-react';
import { siteConfig } from '@/lib/constants';

interface PublicCompanion {
  id: string;
  name: string;
  spec: {
    identity?: { name?: string; pronouns?: string };
    personality?: {
      archetype?: string;
      secondary_archetype?: string;
      traits?: Record<string, number>;
    };
    visual_style?: {
      style_type?: string;
      appearance?: {
        ethnicity?: string;
        bodyType?: string;
        hairColor?: string;
      };
    };
  };
  avatarUrl: string | null;
  createdAt: string;
}

const archetypeLabels: Record<string, string> = {
  caregiver: 'The Caregiver',
  sage: 'The Sage',
  explorer: 'The Explorer',
  creator: 'The Creator',
  hero: 'The Hero',
  jester: 'The Jester',
  lover: 'The Lover',
  magician: 'The Magician',
  ruler: 'The Ruler',
  everyperson: 'The Everyperson',
  innocent: 'The Innocent',
  rebel: 'The Rebel',
  companion: 'The Companion',
};

const traitIcons: Record<string, React.ReactNode> = {
  warmth: <Heart className="w-4 h-4" />,
  energy: <Zap className="w-4 h-4" />,
  empathy: <Brain className="w-4 h-4" />,
  optimism: <Sun className="w-4 h-4" />,
  directness: <MessageCircle className="w-4 h-4" />,
};

function TraitBar({ name, value }: { name: string; value: number }) {
  const percentage = Math.round(value);
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm text-gray-400 flex items-center gap-2">
        {traitIcons[name] || <Sparkles className="w-4 h-4" />}
        <span>{displayName}</span>
      </div>
      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="h-full bg-gradient-to-r from-campfire-500 to-campfire-400 rounded-full"
        />
      </div>
      <span className="w-10 text-sm text-gray-400 text-right">{percentage}%</span>
    </div>
  );
}

export function CompanionSharePage({ companion }: { companion: PublicCompanion }) {
  const { name, spec, avatarUrl } = companion;
  const pronouns = spec?.identity?.pronouns || 'they/them';
  const archetype = spec?.personality?.archetype || 'companion';
  const archetypeLabel = archetypeLabels[archetype] || 'The Companion';
  const traits = spec?.personality?.traits || {};

  // Get top 5 traits to display
  const displayTraits = Object.entries(traits)
    .filter(([key]) => ['warmth', 'energy', 'empathy', 'optimism', 'directness'].includes(key))
    .slice(0, 5);

  return (
    <section className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black py-16 md:py-24">
      <div className="container mx-auto px-4 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="grid md:grid-cols-2 gap-8 md:gap-12 items-start"
        >
          {/* Avatar Section */}
          <div className="relative">
            <div className="aspect-[3/4] relative rounded-2xl overflow-hidden bg-gradient-to-br from-campfire-500/20 to-transparent border border-white/10">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={name}
                  fill
                  className="object-cover"
                  priority
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-24 h-24 text-campfire-500/50" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>

            {/* Archetype Badge */}
            <div className="absolute bottom-4 left-4 right-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm border border-white/20">
                <Sparkles className="w-4 h-4 text-campfire-400" />
                <span className="text-sm font-medium text-white">{archetypeLabel}</span>
              </div>
            </div>
          </div>

          {/* Info Section */}
          <div className="space-y-8">
            <div>
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="text-4xl md:text-5xl font-cal text-white mb-2"
              >
                {name}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="text-gray-400 text-lg"
              >
                {pronouns}
              </motion.p>
            </div>

            {/* Personality Traits */}
            {displayTraits.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="space-y-4"
              >
                <h2 className="text-lg font-semibold text-white">Personality</h2>
                <div className="space-y-3 p-4 rounded-xl bg-white/[0.02] border border-white/10">
                  {displayTraits.map(([trait, value]) => (
                    <TraitBar key={trait} name={trait} value={value} />
                  ))}
                </div>
              </motion.div>
            )}

            {/* CTA Section */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="pt-4"
            >
              <p className="text-gray-400 mb-4">
                Create your own personalized AI companion on Campfire.
              </p>
              <Link
                href={`${siteConfig.appUrl}/onboard`}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white font-medium transition-colors"
              >
                <Sparkles className="w-5 h-5" />
                Create Your Own
              </Link>
            </motion.div>

            {/* Powered by Campfire */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="pt-8 border-t border-white/10"
            >
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-400 transition-colors"
              >
                <span className="text-sm">Powered by</span>
                <span className="font-cal text-lg text-campfire-500">Campfire</span>
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
