'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore, type VoiceOption } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Play, Pause, ArrowRight, AudioWaveform } from 'lucide-react';
import { cn } from '@/lib/utils';

// Mock data for voices
const voices: VoiceOption[] = [
  { id: 'echo', name: 'Echo', description: 'Soft, calm, and soothing.', sampleUrl: '/samples/echo.mp3', gender: 'neutral' },
  { id: 'alloy', name: 'Alloy', description: 'Versatile, neutral, and clear.', sampleUrl: '/samples/alloy.mp3', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, resonant, and authoritative.', sampleUrl: '/samples/onyx.mp3', gender: 'masculine' },
  { id: 'nova', name: 'Nova', description: 'Bright, energetic, and friendly.', sampleUrl: '/samples/nova.mp3', gender: 'feminine' },
  { id: 'shimmer', name: 'Shimmer', description: 'Warm, expressive, and engaging.', sampleUrl: '/samples/shimmer.mp3', gender: 'feminine' },
];

export function Step4Voice() {
  const { voice, setVoice, nextStep } = useOnboardingStore();
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Mock audio player logic
  const togglePlay = (id: string) => {
    if (playingId === id) {
      setPlayingId(null);
    } else {
      setPlayingId(id);
      // In a real app, this would trigger an Audio object
      // For now, we simulate playing for 3 seconds
      setTimeout(() => setPlayingId(null), 3000);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Choose a Voice</h2>
        <p className="text-gray-400 max-w-md mx-auto">Select the voice that best fits your companion's essence.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {voices.map((v) => (
          <motion.div
            key={v.id}
            whileHover={{ x: 5 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Card
              className={cn(
                'flex items-center p-5 transition-all border-white/10 cursor-pointer overflow-hidden relative group',
                voice?.id === v.id ? 'bg-white/[0.08] border-vibes-cyan/50 ring-1 ring-vibes-cyan/20' : 'bg-white/[0.02] hover:bg-white/[0.05]'
              )}
              onClick={() => setVoice(v)}
            >
              <div className="flex-1 z-10">
                <div className="flex items-center gap-5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "rounded-full h-14 w-14 transition-all duration-300",
                      playingId === v.id ? "bg-vibes-cyan text-black" : "bg-white/5 group-hover:bg-white/10 text-vibes-cyan"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay(v.id);
                    }}
                  >
                    {playingId === v.id ? (
                      <Pause className="h-6 w-6 fill-current" />
                    ) : (
                      <Play className="h-6 w-6 ml-1 fill-current" />
                    )}
                  </Button>
                  <div>
                    <h3 className="text-xl font-display font-bold text-white group-hover:text-vibes-cyan transition-colors">{v.name}</h3>
                    <p className="text-sm text-gray-500">{v.description}</p>
                  </div>
                </div>
              </div>

              {playingId === v.id && (
                <div className="flex items-center gap-1.5 px-6 animate-fade-in">
                  <div className="flex gap-1 items-end h-8">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 bg-gradient-to-t from-vibes-electric to-vibes-cyan rounded-full"
                        animate={{
                          height: [8, 24, 12, 28, 10],
                        }}
                        transition={{
                          duration: 0.6,
                          repeat: Infinity,
                          delay: i * 0.1,
                          ease: "easeInOut"
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="z-10 px-4 py-1.5 bg-white/5 rounded-full border border-white/5 text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                {v.gender}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="flex justify-end pt-8">
        <Button
          size="lg"
          disabled={!voice}
          onClick={nextStep}
          className="group h-14 px-12 rounded-full bg-gradient-to-r from-vibes-cyan to-vibes-electric hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg"
        >
          Next: Visuals
          <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
