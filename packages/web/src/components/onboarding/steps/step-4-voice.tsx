'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useOnboardingStore, type VoiceOption } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Play, Pause, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchVoices } from '@/lib/api';

// Build the voice sample URL with customization params
function getVoiceSampleUrl(voiceId: string): string {
  const baseUrl = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3002'
    : '';
  // Use flirty voice settings: lower stability for more expression, higher style for personality
  const params = new URLSearchParams({
    stability: '0.35',
    similarityBoost: '0.75',
    style: '0.45',
    speed: '0.95',
  });
  return `${baseUrl}/api/v1/voice/${voiceId}/sample?${params.toString()}`;
}

export function Step4Voice() {
  const { voice, setVoice, nextStep } = useOnboardingStore();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch voices from API
  useEffect(() => {
    fetchVoices()
      .then(setVoices)
      .catch((err) => console.error('Failed to fetch voices:', err))
      .finally(() => setIsLoadingVoices(false));
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const togglePlay = useCallback(async (id: string) => {
    // If already playing this voice, stop it
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setLoadingId(id);
    setPlayingId(null);

    try {
      const sampleUrl = getVoiceSampleUrl(id);
      const audio = new Audio(sampleUrl);
      audioRef.current = audio;

      audio.oncanplaythrough = () => {
        setLoadingId(null);
        setPlayingId(id);
        audio.play().catch(console.error);
      };

      audio.onended = () => {
        setPlayingId(null);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setLoadingId(null);
        setPlayingId(null);
        audioRef.current = null;
        console.error('Failed to load voice sample');
      };

      audio.load();
    } catch (error) {
      setLoadingId(null);
      setPlayingId(null);
      console.error('Failed to play voice sample:', error);
    }
  }, [playingId]);

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Choose a Voice</h2>
        <p className="text-gray-400 max-w-md mx-auto">Select the voice that best fits your companion's essence.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 max-h-[60vh] overflow-y-auto pr-1">
        {isLoadingVoices ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-vibes-cyan" />
            <span className="ml-3 text-gray-400">Loading voices...</span>
          </div>
        ) : null}
        {voices.map((v) => (
          <motion.div
            key={v.id}
            whileHover={{ x: 5 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Card
              className={cn(
                'flex items-center p-5 transition-all border-white/10 cursor-pointer overflow-hidden relative group',
                voice?.id === v.id ? 'bg-white/[0.08] border-vibes-cyan/50 ring-1 ring-vibes-cyan/30 backdrop-blur-xl' : 'bg-white/[0.01] hover:bg-white/[0.03] backdrop-blur-md'
              )}
              onClick={() => setVoice(v)}
            >
              <div className="flex-1 z-10">
                <div className="flex items-center gap-5">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={loadingId === v.id}
                    className={cn(
                      "rounded-full h-14 w-14 transition-all duration-300",
                      playingId === v.id ? "bg-vibes-cyan text-black" : "bg-white/5 group-hover:bg-white/10 text-vibes-cyan"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay(v.id);
                    }}
                  >
                    {loadingId === v.id ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : playingId === v.id ? (
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

              {(playingId === v.id || loadingId === v.id) && (
                <div className="flex items-center gap-1.5 px-6 animate-fade-in">
                  <div className="flex gap-1 items-end h-8">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <motion.div
                        key={i}
                        className={cn(
                          "w-1.5 rounded-full",
                          loadingId === v.id
                            ? "bg-gradient-to-t from-gray-600 to-gray-400"
                            : "bg-gradient-to-t from-vibes-electric to-vibes-cyan"
                        )}
                        animate={{
                          height: loadingId === v.id ? [8, 12, 8] : [8, 24, 12, 28, 10],
                        }}
                        transition={{
                          duration: loadingId === v.id ? 0.8 : 0.6,
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
          Next: Boundaries
          <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
