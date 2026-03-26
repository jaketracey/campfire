'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Loader2 } from 'lucide-react';
import {
  createCompanion,
  activateCompanion,
  createSession,
} from '@/lib/api';
import type { CompanionSpec } from '@/lib/api/companions';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { useToast } from '@/hooks/use-toast';
import {
  type VibePreset,
  getPresetVoice,
  getPresetAppearance,
} from './vibe-presets';
import type { Pronouns } from './step-name-input';
import { trackOnboardingComplete, trackCompanionCreated } from '@/lib/analytics/meta-pixel';

interface StepFirstChatProps {
  preset: VibePreset;
  companionName: string;
  pronouns: Pronouns;
}

/**
 * Creates the companion with preset defaults, creates a session, and
 * redirects the user into the chat interface.
 */
export function StepFirstChat({ preset, companionName, pronouns }: StepFirstChatProps) {
  const router = useRouter();
  const { toast } = useToast();
  const {
    setCompanionId,
    setSessionId,
    setName,
    setIdentity,
    setArchetype,
    setSecondaryArchetype,
    setPersonality,
    setVoice,
    setAppearance,
  } = useOnboardingStore();

  const [status, setStatus] = useState('Creating your companion...');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function createAndRedirect() {
      try {
        // Build the companion spec from the preset
        const appearance = getPresetAppearance(preset, pronouns);
        const voiceId = getPresetVoice(preset, pronouns);

        const spec: CompanionSpec = {
          identity: {
            name: companionName,
            pronouns,
            backstory: '',
          },
          personality: {
            archetype: preset.archetype,
            secondary_archetype: preset.secondaryArchetype || undefined,
            traits: { ...preset.personalityTraits } as Record<string, number>,
          },
          voice: {
            provider: 'elevenlabs',
            voice_id: voiceId,
          },
          visual_style: {
            style_type: 'photorealistic',
            appearance,
          },
          boundaries: {
            content_rating: 'open',
            relationship_pacing: 'natural',
            emotional_depth: 'moderate',
          },
        };

        // Persist to the onboarding store so the customize flow has the data
        setName(companionName);
        setIdentity({ pronouns, backstory: '' });
        setArchetype({
          id: preset.archetype,
          name: preset.name,
          description: preset.description,
          traits: [],
          icon: preset.icon,
        });
        if (preset.secondaryArchetype) {
          setSecondaryArchetype({
            id: preset.secondaryArchetype,
            name: preset.secondaryArchetype,
            description: '',
            traits: [],
            icon: '',
          });
        }
        setPersonality(preset.personalityTraits);
        setVoice({
          id: voiceId,
          name: '',
          description: '',
          sampleUrl: '',
          gender: pronouns === 'he/him' ? 'masculine' : pronouns === 'she/her' ? 'feminine' : 'neutral',
        });
        setAppearance(appearance);

        // Create the companion via API
        setStatus('Creating your companion...');
        const companion = await createCompanion({
          name: companionName,
          personality: `${preset.name} - ${preset.description}`,
          voiceId,
          spec,
        });
        setCompanionId(companion.id);
        trackCompanionCreated(companion.id);

        // Activate it
        setStatus('Bringing them to life...');
        await activateCompanion(companion.id);

        // Create a session
        setStatus('Starting your first conversation...');
        const session = await createSession({ companionId: companion.id });
        setSessionId(session.id);
        trackOnboardingComplete('quick', 3);

        // Navigate to the chat
        router.push(`/chat/${session.id}` as Route);
      } catch (err) {
        console.error('Quick-meet creation failed:', err);
        toast({
          title: 'Something went wrong',
          description: 'Could not create your companion. Please try again.',
          variant: 'destructive',
        });
      }
    }

    createAndRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 min-h-[40vh]"
      data-testid="step-first-chat"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
          <p className="text-lg text-gray-300 font-medium">{status}</p>
          <p className="text-sm text-gray-500">
            Getting {companionName} ready for you...
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
