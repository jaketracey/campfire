'use client';

import { useOnboardingStore, type PersonalitySliders } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ArrowRight, Heart, MessageCircle, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

interface SliderConfig {
  key: keyof PersonalitySliders;
  label: string;
  lowLabel: string;
  highLabel: string;
  color: string;
}

interface SliderGroup {
  name: string;
  icon: React.ReactNode;
  sliders: SliderConfig[];
}

const colorClasses: Record<string, { text: string; slider: string; sliderBorder: string }> = {
  'vibes-neon': {
    text: 'text-vibes-neon',
    slider: '[&_[role=slider]]:bg-vibes-neon',
    sliderBorder: '[&_[role=slider]]:border-vibes-neon',
  },
  'vibes-hot': {
    text: 'text-vibes-hot',
    slider: '[&_[role=slider]]:bg-vibes-hot',
    sliderBorder: '[&_[role=slider]]:border-vibes-hot',
  },
  'vibes-acid': {
    text: 'text-vibes-acid',
    slider: '[&_[role=slider]]:bg-vibes-acid',
    sliderBorder: '[&_[role=slider]]:border-vibes-acid',
  },
  'vibes-cyan': {
    text: 'text-vibes-cyan',
    slider: '[&_[role=slider]]:bg-vibes-cyan',
    sliderBorder: '[&_[role=slider]]:border-vibes-cyan',
  },
  'vibes-electric': {
    text: 'text-vibes-electric',
    slider: '[&_[role=slider]]:bg-vibes-electric',
    sliderBorder: '[&_[role=slider]]:border-vibes-electric',
  },
};

const sliderGroups: SliderGroup[] = [
  {
    name: 'Emotional Expression',
    icon: <Heart className="h-4 w-4 text-vibes-hot" />,
    sliders: [
      {
        key: 'warmth',
        label: 'Warmth',
        lowLabel: 'Reserved',
        highLabel: 'Affectionate',
        color: 'vibes-neon',
      },
      {
        key: 'empathy',
        label: 'Empathy',
        lowLabel: 'Analytical',
        highLabel: 'Empathetic',
        color: 'vibes-hot',
      },
      {
        key: 'optimism',
        label: 'Optimism',
        lowLabel: 'Realistic',
        highLabel: 'Optimistic',
        color: 'vibes-acid',
      },
    ],
  },
  {
    name: 'Communication Style',
    icon: <MessageCircle className="h-4 w-4 text-vibes-cyan" />,
    sliders: [
      {
        key: 'formality',
        label: 'Formality',
        lowLabel: 'Casual',
        highLabel: 'Formal',
        color: 'vibes-cyan',
      },
      {
        key: 'directness',
        label: 'Directness',
        lowLabel: 'Subtle',
        highLabel: 'Direct',
        color: 'vibes-electric',
      },
      {
        key: 'playfulness',
        label: 'Playfulness',
        lowLabel: 'Serious',
        highLabel: 'Playful',
        color: 'vibes-hot',
      },
    ],
  },
  {
    name: 'Behavioral Tendencies',
    icon: <Zap className="h-4 w-4 text-vibes-acid" />,
    sliders: [
      {
        key: 'energy',
        label: 'Energy',
        lowLabel: 'Calm',
        highLabel: 'Energetic',
        color: 'vibes-neon',
      },
      {
        key: 'assertiveness',
        label: 'Assertiveness',
        lowLabel: 'Passive',
        highLabel: 'Assertive',
        color: 'vibes-cyan',
      },
      {
        key: 'spontaneity',
        label: 'Spontaneity',
        lowLabel: 'Structured',
        highLabel: 'Spontaneous',
        color: 'vibes-acid',
      },
      {
        key: 'curiosity',
        label: 'Curiosity',
        lowLabel: 'Incurious',
        highLabel: 'Curious',
        color: 'vibes-electric',
      },
    ],
  },
];

export function Step5Traits() {
  const { personality, setPersonality, nextStep } = useOnboardingStore();

  const handleSliderChange = (key: keyof PersonalitySliders) => (value: number[]) => {
    setPersonality({ [key]: value[0] });
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">
          Fine-tune Personality
        </h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Adjust these traits to shape your companion&apos;s unique personality profile.
        </p>
      </div>

      <div className="space-y-6">
        {sliderGroups.map((group, groupIndex) => (
          <motion.div
            key={group.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * 0.1 }}
          >
            <Card className="bg-white/[0.01] backdrop-blur-xl border-white/10">
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-center gap-2">
                  {group.icon}
                  <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">
                    {group.name}
                  </h3>
                </div>
                {group.sliders.map((slider) => (
                  <div key={slider.key} className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs font-bold tracking-widest uppercase text-gray-400">
                          {slider.label}
                        </Label>
                        <span className="text-[10px] text-gray-600">
                          {slider.lowLabel} ↔ {slider.highLabel}
                        </span>
                      </div>
                      <span className={`text-sm font-mono font-bold ${colorClasses[slider.color]?.text}`}>
                        {personality[slider.key]}%
                      </span>
                    </div>
                    <Slider
                      value={[personality[slider.key]]}
                      onValueChange={handleSliderChange(slider.key)}
                      max={100}
                      step={1}
                      className={`${colorClasses[slider.color]?.slider} ${colorClasses[slider.color]?.sliderBorder} [&_.relative]:bg-white/10`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <Button
          size="lg"
          onClick={nextStep}
          className="group h-14 px-12 rounded-full bg-gradient-to-r from-vibes-hot to-vibes-neon hover:shadow-[0_0_30px_rgba(236,72,153,0.3)] transition-all font-bold text-lg"
        >
          Next: Behavioral Rules
          <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
