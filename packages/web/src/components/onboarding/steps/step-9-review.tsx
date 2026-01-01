'use client';

import { useState } from 'react';
import { useOnboardingStore, type TenetCategory } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Sparkles, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { createCompanion, createSession } from '@/lib/api';
import { cn } from '@/lib/utils';

// Tenet category metadata for display
const TENET_CATEGORY_META: Record<TenetCategory, { label: string; color: string }> = {
  communication: { label: 'Communication', color: 'cyan' },
  boundaries: { label: 'Boundaries', color: 'red' },
  engagement: { label: 'Engagement', color: 'green' },
  emotional: { label: 'Emotional', color: 'pink' },
  knowledge: { label: 'Knowledge', color: 'blue' },
  autonomy: { label: 'Autonomy', color: 'amber' },
};

export function Step9Review() {
  const router = useRouter();
  const { toast } = useToast();
  const state = useOnboardingStore();
  const [isCreating, setIsCreating] = useState(false);

  const coreTenets = state.tenets.filter((t) => t.priority === 'core');

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // Build personality description from archetype and sliders
      const personalityDescription = [
        state.archetype?.description || '',
        state.secondaryArchetype
          ? `Secondary archetype: ${state.secondaryArchetype.name}`
          : '',
        `Traits: ${state.archetype?.traits.join(', ') || 'friendly'}`,
        `Warmth: ${state.personality.warmth}%, Humor: ${state.personality.humor}%`,
        `Empathy: ${state.personality.empathy}%, Energy: ${state.personality.energy}%`,
        state.identity.backstory ? `Background: ${state.identity.backstory}` : '',
        coreTenets.length > 0
          ? `Core behavioral rules:\n${coreTenets.map((t) => `- ${t.isNegation ? 'NEVER: ' : ''}${t.rule}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      // Create companion via API
      const companion = await createCompanion({
        name: state.name,
        description: state.archetype?.description,
        personality: personalityDescription,
        voiceId: state.voice?.id,
        isPublic: false,
      });

      console.log('Companion created:', companion);

      // Create a session with the new companion
      const session = await createSession({
        companionId: companion.id,
        title: `Chat with ${companion.name}`,
      });

      console.log('Session created:', session);

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
      setIsCreating(false);
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
            <div className="h-20 w-20 rounded-3xl bg-vibes-neon/10 flex items-center justify-center text-4xl border border-vibes-neon/20 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
              {state.archetype?.icon}
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

      <div className="pt-6 space-y-6">
        <Button
          size="lg"
          className="w-full h-20 text-2xl font-bold rounded-2xl bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all duration-500 hover:scale-[1.02] active:scale-[0.98] text-white"
          onClick={handleCreate}
          disabled={isCreating}
        >
          {isCreating ? (
            <>
              <Loader2 className="mr-3 h-8 w-8 animate-spin" />
              Igniting Companion...
            </>
          ) : (
            <>
              <Sparkles className="mr-3 h-8 w-8" />
              Bring to Life
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
