'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { MessageCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { createCompanion, createSession } from '@/lib/api';
import type { CompanionAppearance } from '@/lib/api/companions';
import type { FeaturedCompanion } from '@/data/featured-companions';

interface CompanionCardProps {
  companion: FeaturedCompanion;
  index: number;
}

export function CompanionCard({ companion, index }: CompanionCardProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [isCreating, setIsCreating] = useState(false);

  const handleChatNow = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isAuthenticated) {
      const params = new URLSearchParams();
      params.set('returnTo', '/explore');
      params.set('presetId', companion.id);
      router.push(`/signup?${params.toString()}`);
      return;
    }

    setIsCreating(true);
    try {
      // Build appearance with proper type narrowing
      const appearance: CompanionAppearance = companion.appearance.gender === 'female'
        ? {
            gender: 'female' as const,
            ethnicity: companion.appearance.ethnicity as CompanionAppearance['ethnicity'],
            hairColor: companion.appearance.hairColor as CompanionAppearance['hairColor'],
            bodyType: companion.appearance.bodyType as 'slim' | 'athletic' | 'curvy' | 'plus-size',
            breastSize: 'M' as const,
          }
        : {
            gender: 'male' as const,
            ethnicity: companion.appearance.ethnicity as CompanionAppearance['ethnicity'],
            hairColor: companion.appearance.hairColor as CompanionAppearance['hairColor'],
            bodyType: companion.appearance.bodyType as 'slim' | 'athletic' | 'muscular' | 'dad-bod',
            build: 'M' as const,
          };

      // Create companion from preset data
      const newCompanion = await createCompanion({
        name: companion.name,
        description: companion.tagline,
        personality: companion.archetype,
        voiceId: companion.voiceId,
        isPublic: false,
        spec: {
          identity: {
            name: companion.name,
            backstory: companion.backstory,
          },
          personality: {
            archetype: companion.archetype,
            traits: companion.personality,
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: companion.voiceId,
          },
          visual_style: {
            appearance,
          },
        },
      });

      // Create a session for the new companion
      const session = await createSession({
        companionId: newCompanion.id,
      });

      router.push(`/chat/${session.id}`);
    } catch (error) {
      console.error('Failed to create companion session:', error);
      setIsCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.6), duration: 0.4 }}
      data-testid={`companion-card-${companion.id}`}
    >
      <Card
        className="group relative overflow-hidden bg-white/[0.02] border border-white/5 hover:border-white/20 transition-all duration-300 shadow-lg hover:shadow-2xl hover:scale-[1.03] cursor-pointer"
        onClick={handleChatNow}
      >
        <CardContent className="p-0">
          {/* Avatar / gradient placeholder */}
          <div className="aspect-[3/4] relative overflow-hidden">
            <div
              className={`absolute inset-0 bg-gradient-to-br ${companion.gradient} opacity-60`}
            />
            {/* Gradient name initial as placeholder */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-6xl sm:text-7xl font-bold font-display text-white/30 select-none">
                {companion.name[0]}
              </span>
            </div>
            {/* Bottom gradient for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />

            {/* Card content overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 z-10 space-y-2">
              {/* Archetype badge */}
              <span className="inline-block text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-white/60 bg-white/10 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/10">
                {companion.archetypeLabel}
              </span>

              {/* Name + tagline */}
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white leading-tight font-display">
                  {companion.name}
                </h3>
                <p className="text-[11px] sm:text-xs text-white/60 leading-snug mt-0.5 line-clamp-2">
                  {companion.tagline}
                </p>
              </div>

              {/* Trait pills */}
              <div className="flex flex-wrap gap-1">
                {companion.traits.map((trait) => (
                  <span
                    key={trait}
                    className="text-[9px] sm:text-[10px] font-medium text-white/70 bg-white/[0.08] px-1.5 py-0.5 rounded-full border border-white/[0.06]"
                  >
                    {trait}
                  </span>
                ))}
              </div>

              {/* Chat Now button */}
              <Button
                onClick={handleChatNow}
                disabled={isCreating}
                className="w-full h-8 sm:h-9 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-xs sm:text-sm font-semibold border border-white/10 hover:border-white/20 transition-all opacity-0 group-hover:opacity-100 mt-1"
                data-testid={`chat-now-${companion.id}`}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                    Chat Now
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
