'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowRight, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CompanionAvatar } from '@/components/companion';

const styles = [
  {
    id: 'realistic',
    name: 'Realistic',
    description: 'Lifelike 3D rendering.',
    previewColor: 'bg-zinc-800',
  },
  {
    id: 'stylized',
    name: 'Stylized 3D',
    description: 'Pixar/Disney style animation.',
    previewColor: 'bg-blue-600',
  },
  {
    id: 'abstract',
    name: 'Abstract',
    description: 'Geometric shapes and light.',
    previewColor: 'bg-purple-600',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean lines and flat colors.',
    previewColor: 'bg-emerald-600',
  },
];

export function Step5Visuals() {
  const { visualStyle, setVisualStyle, personality, nextStep } = useOnboardingStore();
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageCacheKey, setImageCacheKey] = useState<string | null>(null);
  const [regenerateKey, setRegenerateKey] = useState(0);

  const handleImageLoad = useCallback((url: string, cacheKey: string) => {
    setGeneratedImageUrl(url);
    setImageCacheKey(cacheKey);
  }, []);

  const handleRegenerate = useCallback(() => {
    setRegenerateKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Visual Identity</h2>
        <p className="text-gray-400 max-w-md mx-auto">Choose the physical manifestation of your companion.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Style Selection */}
        <div className="flex-1 w-full">
          <div className="grid grid-cols-2 gap-4">
            {styles.map((style) => (
              <motion.div
                key={style.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Card
                  className={cn(
                    'group relative overflow-hidden cursor-pointer transition-all border-white/10 bg-white/[0.02]',
                    visualStyle.avatarStyle === style.id ? 'ring-2 ring-vibes-cyan border-vibes-cyan/50 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : 'hover:border-white/20 hover:bg-white/[0.05]'
                  )}
                  onClick={() => setVisualStyle({ avatarStyle: style.id as any })}
                >
                  <div className={cn('h-20 w-full transition-all duration-500 relative overflow-hidden', style.previewColor)}>
                    {visualStyle.avatarStyle === style.id && (
                      <motion.div
                        layoutId="style-glow"
                        className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                      <Sparkles className="text-white h-8 w-8 drop-shadow-lg animate-pulse" />
                    </div>
                  </div>
                  <CardHeader className="p-4 space-y-1">
                    <CardTitle className="text-base font-display font-bold text-white group-hover:text-vibes-cyan transition-colors">{style.name}</CardTitle>
                    <CardDescription className="text-xs text-gray-500">{style.description}</CardDescription>
                  </CardHeader>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Avatar Preview Area */}
        <div className="flex flex-col items-center gap-6 p-6 rounded-3xl bg-white/[0.02] border border-white/10 backdrop-blur-xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-vibes-cyan/5 via-transparent to-vibes-neon/5 opacity-50" />

          <div className="relative z-10 w-full max-w-[280px]">
            <CompanionAvatar
              key={regenerateKey}
              style={visualStyle.avatarStyle as 'realistic' | 'stylized' | 'abstract' | 'minimal'}
              personality={personality}
              emotionalState="neutral"
              width={280}
              height={420}
              onLoad={handleImageLoad}
              autoRegenerate={true}
              debounceDelay={1500}
              className="shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-2xl border border-white/10 animate-fade-in"
            />
          </div>

          <div className="flex flex-col items-center gap-2 z-10 w-full">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              className="gap-2 text-gray-400 hover:text-white hover:bg-white/5 transition-all w-full"
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate Appearance
            </Button>
            {imageCacheKey && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 border border-white/5">
                <div className="w-1.5 h-1.5 rounded-full bg-vibes-cyan animate-pulse" />
                <span className="text-[10px] font-mono text-gray-500 tracking-wider">
                  SAVED: {imageCacheKey.slice(0, 8).toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-8">
        <Button
          size="lg"
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
