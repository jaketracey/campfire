'use client';

import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

const archetypes = [
  {
    id: 'sage',
    name: 'The Sage',
    description: 'Wise, thoughtful, and analytical.',
    icon: '🦉',
    traits: ['Knowledgeable', 'Calm', 'Objective'],
  },
  {
    id: 'friend',
    name: 'Best Friend',
    description: 'Supportive, casual, and empathetic.',
    icon: '🐕',
    traits: ['Loyal', 'Warm', 'Playful'],
  },
  {
    id: 'explorer',
    name: 'The Explorer',
    description: 'Curious, energetic, and adventurous.',
    icon: '🧭',
    traits: ['Excited', 'Bold', 'Inquisitive'],
  },
  {
    id: 'assistant',
    name: 'The Assistant',
    description: 'Efficient, precise, and helpful.',
    icon: '🤖',
    traits: ['Organized', 'Formal', 'Reliable'],
  },
];

export function Step3Personality() {
  const {
    archetype,
    personality,
    setArchetype,
    setPersonality,
    nextStep,
  } = useOnboardingStore();

  const handleSliderChange = (key: keyof typeof personality) => (value: number[]) => {
    setPersonality({ [key]: value[0] });
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Personality</h2>
        <p className="text-gray-400 max-w-md mx-auto">Define how your companion thinks and behaves in this digital campfire.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {archetypes.map((type) => (
          <motion.div
            key={type.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Card
              className={cn(
                'cursor-pointer transition-all border-white/10 overflow-hidden relative group',
                archetype?.id === type.id
                  ? 'bg-white/[0.08] border-vibes-neon/50 ring-1 ring-vibes-neon/20 shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                  : 'bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20'
              )}
              onClick={() => setArchetype(type as any)}
            >
              {archetype?.id === type.id && (
                <motion.div
                  layoutId="active-border"
                  className="absolute top-0 left-0 w-1 h-full bg-vibes-neon"
                />
              )}
              <CardHeader className="p-5">
                <div className="flex items-center gap-4">
                  <div className="text-4xl filter drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">{type.icon}</div>
                  <div>
                    <CardTitle className="text-xl font-display font-bold text-white transition-colors group-hover:text-vibes-neon">{type.name}</CardTitle>
                    <CardDescription className="text-gray-500 line-clamp-1">{type.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </motion.div>
        ))}
      </div>

      {archetype && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8 pt-4"
        >
          <Card className="bg-white/[0.02] backdrop-blur-3xl border-white/10 shadow-xl">
            <CardContent className="pt-8 space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label className="text-xs font-bold tracking-widest uppercase text-gray-500 font-display">Warmth vs Stoicism</Label>
                  <span className="text-sm font-mono text-vibes-neon font-bold">{personality.warmth}%</span>
                </div>
                <Slider
                  value={[personality.warmth]}
                  onValueChange={handleSliderChange('warmth')}
                  max={100}
                  step={1}
                  className="[&_[role=slider]]:bg-vibes-neon [&_[role=slider]]:border-vibes-neon [&_.relative]:bg-white/10"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label className="text-xs font-bold tracking-widest uppercase text-gray-500 font-display">Playfulness vs Serious</Label>
                  <span className="text-sm font-mono text-vibes-hot font-bold">{personality.playfulness}%</span>
                </div>
                <Slider
                  value={[personality.playfulness]}
                  onValueChange={handleSliderChange('playfulness')}
                  max={100}
                  step={1}
                  className="[&_[role=slider]]:bg-vibes-hot [&_[role=slider]]:border-vibes-hot [&_.relative]:bg-white/10"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <Label className="text-xs font-bold tracking-widest uppercase text-gray-500 font-display">Curiosity</Label>
                  <span className="text-sm font-mono text-vibes-cyan font-bold">{personality.curiosity}%</span>
                </div>
                <Slider
                  value={[personality.curiosity]}
                  onValueChange={handleSliderChange('curiosity')}
                  max={100}
                  step={1}
                  className="[&_[role=slider]]:bg-vibes-cyan [&_[role=slider]]:border-vibes-cyan [&_.relative]:bg-white/10"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end pt-4">
            <Button
              size="lg"
              onClick={nextStep}
              className="group h-14 px-12 rounded-full bg-gradient-to-r from-vibes-neon to-vibes-hot hover:shadow-[0_0_30px_rgba(236,72,153,0.3)] transition-all font-bold text-lg"
            >
              Next: Voice
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
