'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoiceOption } from '@/stores/onboarding-store';

// ElevenLabs voices matching step-7-voice.tsx
const voices: VoiceOption[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, warm, and naturally alluring.', sampleUrl: '', gender: 'feminine' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Calm, soothing, with a hint of playfulness.', sampleUrl: '', gender: 'feminine' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Elegant, seductive, and confident.', sampleUrl: '', gender: 'feminine' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Sweet, youthful, and energetic.', sampleUrl: '', gender: 'feminine' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', description: 'Expressive, friendly, and engaging.', sampleUrl: '', gender: 'feminine' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep, resonant, and authoritative.', sampleUrl: '', gender: 'masculine' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', description: 'Smooth, charming, and sophisticated.', sampleUrl: '', gender: 'masculine' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', description: 'Warm, intimate, and captivating.', sampleUrl: '', gender: 'masculine' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Friendly, playful, and inviting.', sampleUrl: '', gender: 'neutral' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Rich, thoughtful, and comforting.', sampleUrl: '', gender: 'masculine' },
];

interface VoiceDisplayProps {
  voiceId: string;
  onComplete: () => void;
  autoAdvance?: boolean;
}

export function VoiceDisplay({ voiceId, onComplete, autoAdvance = true }: VoiceDisplayProps) {
  const [showHighlight, setShowHighlight] = useState(false);
  const [showWaveform, setShowWaveform] = useState(false);

  const selectedVoice = voices.find((v) => v.id === voiceId);

  useEffect(() => {
    const timers = [
      setTimeout(() => setShowHighlight(true), 200),
      setTimeout(() => setShowWaveform(true), 400),
    ];
    // Only auto-advance if enabled (not when user navigated back)
    if (autoAdvance) {
      timers.push(setTimeout(onComplete, 1000));
    }

    return () => timers.forEach(clearTimeout);
  }, [onComplete, autoAdvance]);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Choose a Voice</h2>
        <p className="text-gray-400 max-w-md mx-auto">Select the voice that best fits your companion&apos;s essence.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 max-w-2xl mx-auto">
        {voices.map((v) => {
          const isSelected = v.id === voiceId;
          return (
            <motion.div
              key={v.id}
              initial={{ opacity: 0.4 }}
              animate={showHighlight && isSelected ? {
                opacity: 1,
                scale: [1, 1.02, 1.01],
              } : { opacity: 0.4 }}
              transition={{ duration: 0.2 }}
            >
              <Card
                className={cn(
                  'flex items-center p-4 transition-all border-white/10 overflow-hidden relative',
                  showHighlight && isSelected
                    ? 'bg-vibes-cyan/20 border-vibes-cyan ring-2 ring-vibes-cyan shadow-[0_0_30px_rgba(6,182,212,0.4)] backdrop-blur-xl'
                    : 'bg-white/[0.01] backdrop-blur-md'
                )}
              >
                <div className="flex-1 z-10">
                  <div className="flex items-center gap-4">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled
                      className={cn(
                        "rounded-full h-12 w-12 aspect-square flex-shrink-0 transition-all duration-300",
                        showHighlight && isSelected ? "bg-vibes-cyan text-black" : "bg-white/5 text-vibes-cyan"
                      )}
                    >
                      <Play className="h-5 w-5 ml-0.5 fill-current" />
                    </Button>
                    <div>
                      <h3 className={cn(
                        "text-lg font-display font-bold transition-colors",
                        showHighlight && isSelected ? "text-vibes-cyan" : "text-white"
                      )}>
                        {v.name}
                      </h3>
                      <p className="text-sm text-gray-500">{v.description}</p>
                    </div>
                  </div>
                </div>

                {/* Animated waveform for selected voice */}
                {showWaveform && isSelected && (
                  <div className="flex items-center gap-1.5 px-4 animate-fade-in">
                    <div className="flex gap-1 items-end h-6">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1 rounded-full bg-gradient-to-t from-vibes-electric to-vibes-cyan"
                          animate={{
                            height: [6, 18, 10, 22, 8],
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

                <div className="z-10 px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[10px] font-bold tracking-widest text-gray-500 uppercase font-display">
                  {v.gender}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
