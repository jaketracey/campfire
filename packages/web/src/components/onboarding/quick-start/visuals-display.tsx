'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import type {
  AppearanceEthnicity,
  AppearanceHairColor,
  SizeCategory,
  CompanionGender,
  FemaleBodyType,
  MaleBodyType,
} from '@/stores/onboarding-store';
import type { CompanionAppearance } from '@/lib/api/companions';

// Options matching step-3-visuals.tsx
const ethnicityOptions: Array<{
  id: AppearanceEthnicity;
  name: string;
  description: string;
}> = [
  { id: 'east-asian', name: 'East Asian', description: 'Korean, Japanese, Chinese' },
  { id: 'south-asian', name: 'South Asian', description: 'Indian, Pakistani, Bengali' },
  { id: 'black', name: 'Black', description: 'African, African American' },
  { id: 'caucasian', name: 'Caucasian', description: 'European' },
  { id: 'latina', name: 'Latina', description: 'Hispanic, Latin American' },
  { id: 'middle-eastern', name: 'Middle Eastern', description: 'Persian, Arab' },
  { id: 'mixed', name: 'Mixed', description: 'Diverse heritage' },
];

const femaleBodyTypeOptions: Array<{ id: FemaleBodyType; name: string }> = [
  { id: 'slim', name: 'Slim' },
  { id: 'athletic', name: 'Athletic' },
  { id: 'curvy', name: 'Curvy' },
  { id: 'plus-size', name: 'Plus Size' },
];

const maleBodyTypeOptions: Array<{ id: MaleBodyType; name: string }> = [
  { id: 'slim', name: 'Slim' },
  { id: 'athletic', name: 'Athletic' },
  { id: 'muscular', name: 'Muscular' },
  { id: 'dad-bod', name: 'Dad Bod' },
];

const hairColorOptions: Array<{ id: AppearanceHairColor; name: string; color: string }> = [
  { id: 'black', name: 'Black', color: 'bg-gray-900' },
  { id: 'brown', name: 'Brown', color: 'bg-amber-800' },
  { id: 'blonde', name: 'Blonde', color: 'bg-amber-300' },
  { id: 'red', name: 'Red', color: 'bg-red-600' },
  { id: 'fantasy', name: 'Fantasy', color: 'bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500' },
];

const artStyles = [
  { id: 'realistic', name: 'Realistic', description: 'Lifelike rendering' },
  { id: 'anime', name: 'Anime', description: 'Hand-drawn aesthetic' },
  { id: 'stylized', name: 'Stylized', description: 'Artistic interpretation' },
  { id: 'abstract', name: 'Abstract', description: 'Geometric shapes' },
  { id: 'minimal', name: 'Minimal', description: 'Clean lines' },
];

function getPreviewImagePath(appearance: CompanionAppearance): string {
  const gender = appearance.gender;
  const sizePrefix = gender === 'female' ? 'b' : 'build';
  const size = gender === 'female'
    ? (appearance as { breastSize: SizeCategory }).breastSize
    : (appearance as { build: SizeCategory }).build;
  return `/images/companions/${gender}/${appearance.ethnicity}-${appearance.bodyType}-${appearance.hairColor}-${sizePrefix}${size}.png`;
}

function getFallbackImagePath(ethnicity: AppearanceEthnicity, gender: CompanionGender): string {
  return `/images/companions/${gender}/${ethnicity}-athletic-black-${gender === 'female' ? 'b' : 'build'}M.png`;
}

interface VisualsDisplayProps {
  appearance: CompanionAppearance;
  onComplete: () => void;
  autoAdvance?: boolean;
}

export function VisualsDisplay({
  appearance,
  onComplete,
  autoAdvance = true,
}: VisualsDisplayProps) {
  const { ethnicity, bodyType, hairColor, gender } = appearance;
  const bodyTypeOptions = gender === 'male' ? maleBodyTypeOptions : femaleBodyTypeOptions;
  const [showEthnicity, setShowEthnicity] = useState(false);
  const [showBodyType, setShowBodyType] = useState(false);
  const [showHairColor, setShowHairColor] = useState(false);
  const [showArtStyle, setShowArtStyle] = useState(false);
  const [imageError, setImageError] = useState(false);

  const previewImagePath = useMemo(() => {
    return getPreviewImagePath(appearance);
  }, [appearance]);

  const fallbackImagePath = useMemo(() => {
    return getFallbackImagePath(ethnicity, gender);
  }, [ethnicity, gender]);

  useEffect(() => {
    // Cascade animations
    const timers = [
      setTimeout(() => setShowEthnicity(true), 200),
      setTimeout(() => setShowBodyType(true), 500),
      setTimeout(() => setShowHairColor(true), 800),
      setTimeout(() => setShowArtStyle(true), 1100),
    ];
    // Only auto-advance if enabled (not when user navigated back)
    if (autoAdvance) {
      timers.push(setTimeout(onComplete, 1800));
    }

    return () => timers.forEach(clearTimeout);
  }, [onComplete, autoAdvance]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center lg:text-left space-y-2">
        <h2 className="text-4xl font-bold font-display tracking-tight text-white">Visual Identity</h2>
        <p className="text-gray-400 max-w-md mx-auto lg:mx-0">Design your companion&apos;s physical appearance and art style.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Options */}
        <div className="lg:col-span-2 space-y-5 order-2 lg:order-1">
          {/* Ethnicity */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Ethnicity</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ethnicityOptions.map((option) => {
                const isSelected = option.id === ethnicity;
                return (
                  <motion.div
                    key={option.id}
                    initial={{ opacity: 0.5, scale: 0.98 }}
                    animate={showEthnicity && isSelected ? {
                      opacity: 1,
                      scale: [1, 1.05, 1.02],
                    } : { opacity: 0.6, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      'relative p-2.5 rounded-xl border text-left transition-all',
                      showEthnicity && isSelected
                        ? 'border-vibes-cyan bg-vibes-cyan/10 shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                        : 'border-white/10 bg-white/[0.02]'
                    )}
                  >
                    {showEthnicity && isSelected && (
                      <div className="absolute top-2 right-2">
                        <Check className="h-3.5 w-3.5 text-vibes-cyan" />
                      </div>
                    )}
                    <div className="font-medium text-white text-sm">{option.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{option.description}</div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Body Type */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Body Type</h3>
            <div className="flex flex-wrap gap-2">
              {bodyTypeOptions.map((option) => {
                const isSelected = option.id === bodyType;
                return (
                  <motion.div
                    key={option.id}
                    initial={{ opacity: 0.5 }}
                    animate={showBodyType && isSelected ? {
                      opacity: 1,
                      scale: [1, 1.1, 1.05],
                    } : { opacity: 0.6 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      'px-3.5 py-1.5 rounded-full border text-sm font-medium transition-all',
                      showBodyType && isSelected
                        ? 'border-vibes-cyan bg-vibes-cyan/10 text-vibes-cyan shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                        : 'border-white/10 bg-white/[0.02] text-gray-400'
                    )}
                  >
                    {option.name}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Hair Color */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Hair Color</h3>
            <div className="flex flex-wrap gap-2">
              {hairColorOptions.map((option) => {
                const isSelected = option.id === hairColor;
                return (
                  <motion.div
                    key={option.id}
                    initial={{ opacity: 0.5 }}
                    animate={showHairColor && isSelected ? {
                      opacity: 1,
                      scale: [1, 1.15, 1.08],
                    } : { opacity: 0.6 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all',
                      showHairColor && isSelected
                        ? 'border-vibes-cyan bg-vibes-cyan/10 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                        : 'border-white/10 bg-white/[0.02]'
                    )}
                  >
                    <div className={cn('w-4 h-4 rounded-full', option.color)} />
                    <span className={cn(
                      'text-sm font-medium',
                      showHairColor && isSelected ? 'text-vibes-cyan' : 'text-gray-400'
                    )}>
                      {option.name}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Art Style - Always photorealistic */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">Art Style</h3>
            <div className="flex flex-wrap gap-2">
              <motion.div
                initial={{ opacity: 0.5 }}
                animate={showArtStyle ? {
                  opacity: 1,
                  scale: [1, 1.1, 1.05],
                } : { opacity: 0.6 }}
                transition={{ duration: 0.3 }}
                className={cn(
                  'px-4 py-2 rounded-full border text-sm font-bold transition-all flex items-center gap-2',
                  showArtStyle
                    ? 'border-vibes-electric bg-vibes-electric/10 text-vibes-electric shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                    : 'border-white/10 bg-white/[0.02] text-gray-400'
                )}
              >
                Photorealistic
              </motion.div>
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="flex flex-col items-center gap-4 order-1 lg:order-2">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="relative w-full aspect-[3/4] max-w-[240px] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02]"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-vibes-cyan/5 via-transparent to-vibes-neon/5 z-10 pointer-events-none" />
            <Image
              src={imageError ? fallbackImagePath : previewImagePath}
              alt="Companion preview"
              fill
              className="object-cover"
              priority
              onError={() => setImageError(true)}
            />
            <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/80 to-transparent z-10">
              <div className="text-center">
                <span className="text-xs text-white/60 capitalize">
                  {hairColor === 'fantasy' ? ' ' : ''}{hairColor} hair
                </span>
              </div>
            </div>
          </motion.div>

          <div className="text-center space-y-1">
            <div className="text-xs text-gray-500 capitalize">
              {ethnicity.replace('-', ' ')} · {bodyType} · {hairColor} hair
            </div>
            <div className="text-xs text-gray-600">
              Art style: Photorealistic
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
