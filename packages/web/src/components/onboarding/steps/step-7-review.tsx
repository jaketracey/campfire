'use client';

import { useState } from 'react';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { createCompanion, createSession } from '@/lib/api';

export function Step7Review() {
  const router = useRouter();
  const { toast } = useToast();
  const state = useOnboardingStore();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // Build personality description from archetype and sliders
      const personalityDescription = [
        state.archetype?.description || '',
        `Traits: ${state.archetype?.traits.join(', ') || 'friendly'}`,
        `Warmth: ${state.personality.warmth}%, Playfulness: ${state.personality.playfulness}%`,
        `Directness: ${state.personality.directness}%, Empathy: ${state.personality.empathy}%`,
        state.identity.backstory ? `Background: ${state.identity.backstory}` : '',
      ].filter(Boolean).join('\n');

      // Convert personality sliders to 0-1 range for spec
      const normalizedTraits = Object.fromEntries(
        Object.entries(state.personality).map(([key, value]) => [key, value / 100])
      );

      // Create companion via API with full spec
      const companion = await createCompanion({
        name: state.name,
        description: state.archetype?.description,
        personality: personalityDescription,
        voiceId: state.voice?.id,
        isPublic: false,
        spec: {
          identity: {
            name: state.name,
            pronouns: state.identity.pronouns || 'they/them',
            address_style: 'friendly',
          },
          personality: {
            archetype: state.archetype?.id || 'companion',
            secondary_archetype: state.secondaryArchetype?.id,
            traits: normalizedTraits,
          },
          voice: state.voice ? {
            provider: 'elevenlabs',
            voice_id: state.voice.id,
          } : undefined,
          visual_style: {
            style_type: state.visualStyle.avatarStyle,
            appearance: {
              ethnicity: state.visualStyle.appearance.ethnicity,
              bodyType: state.visualStyle.appearance.bodyType,
              hairColor: state.visualStyle.appearance.hairColor,
              breastSize: state.visualStyle.appearance.breastSize,
            },
          },
          boundaries: {
            relationship_pacing: state.boundaries.interactionStyle,
            topics_avoid: state.boundaries.avoidTopics,
            safe_topics: state.boundaries.safeTopics,
            content_rating: 'PG-13',
            emotional_depth: state.boundaries.emotionalDepth,
          },
          memory_consent: {
            allow_long_term: state.boundaries.consentToMemory,
            allow_kg_extraction: state.boundaries.consentToLearning,
          },
        },
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

  return (
    <div className="space-y-10">
      <div className="text-center space-y-3">
        <h2 className="text-4xl md:text-5xl font-bold font-display tracking-tight text-white leading-tight">Review your <span className="text-vibes-neon">Companion</span></h2>
        <p className="text-gray-400 max-w-md mx-auto">Ready to ignite {state.name} and bring them into the digital campfire?</p>
      </div>

      <Card className="border-0 bg-transparent shadow-none">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan" />
        <CardContent className="p-8 space-y-8">
          <div className="flex items-center gap-6">
            <div className="h-20 w-20 rounded-3xl bg-vibes-neon/10 flex items-center justify-center text-4xl border border-vibes-neon/20 shadow-[0_0_20px_rgba(168,85,247,0.2)]">
              {state.archetype?.icon}
            </div>
            <div>
              <h3 className="text-3xl font-bold font-display text-white">{state.name}</h3>
              <p className="text-gray-500 font-medium">{state.identity.pronouns} • <span className="text-vibes-neon">{state.archetype?.name}</span></p>
            </div>
          </div>

          <Separator className="bg-white/5" />

          <div className="grid grid-cols-2 gap-8 text-sm">
            <div className="space-y-1">
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">Voice</span>
              <span className="text-lg font-bold text-gray-200 block">{state.voice?.name}</span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">Visual Style</span>
              <span className="text-lg font-bold text-gray-200 block capitalize">{state.visualStyle.avatarStyle}</span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">Body Detail</span>
              <span className="text-lg font-bold text-gray-200 block">Breast Size: {state.visualStyle.appearance.breastSize}%</span>
            </div>
            <div className="col-span-2 space-y-3">
              <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">Personality Traits</span>
              <div className="flex gap-2 flex-wrap">
                {state.archetype?.traits.map(t => (
                  <span key={t} className="px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/5 text-gray-300 text-xs font-bold">
                    {t}
                  </span>
                ))}
              </div>
            </div>
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
          By igniting {state.name}, you agree to our <span className="underline cursor-pointer">Terms of Service</span> and <span className="underline cursor-pointer">Privacy Policy</span>.
        </p>
      </div>
    </div>
  );
}
