'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingStore, AppearanceEthnicity, AppearanceBodyType, AppearanceHairColor } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

// Convert 0-100 breast size to label (xs, sm, md, lg, xl)
function getBreastSizeLabel(value: number): string {
  if (value <= 20) return 'xs';
  if (value <= 40) return 'sm';
  if (value <= 60) return 'md';
  if (value <= 80) return 'lg';
  return 'xl';
}

// Ethnicity options
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

const bodyTypeOptions: Array<{ id: AppearanceBodyType; name: string }> = [
  { id: 'slim', name: 'Slim' },
  { id: 'athletic', name: 'Athletic' },
  { id: 'curvy', name: 'Curvy' },
  { id: 'plus-size', name: 'Plus Size' },
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

const defaultAppearance = {
  ethnicity: 'mixed' as AppearanceEthnicity,
  bodyType: 'athletic' as AppearanceBodyType,
  hairColor: 'brown' as AppearanceHairColor,
};

// Build dynamic image path based on all selections including breast size
function getPreviewImagePath(
  ethnicity: AppearanceEthnicity,
  bodyType: AppearanceBodyType,
  hairColor: AppearanceHairColor,
  breastSize: number
): string {
  const breastLabel = getBreastSizeLabel(breastSize);
  return `/images/companions/${ethnicity}-${bodyType}-${hairColor}-b${breastLabel}.png`;
}

// Legacy path without breast size (for fallback)
function getLegacyImagePath(
  ethnicity: AppearanceEthnicity,
  bodyType: AppearanceBodyType,
  hairColor: AppearanceHairColor
): string {
  return `/images/companions/${ethnicity}-${bodyType}-${hairColor}.png`;
}

// Fallback images for each ethnicity (used when specific combo doesn't exist)
function getFallbackImagePath(ethnicity: AppearanceEthnicity): string {
  const fallbacks: Record<AppearanceEthnicity, string> = {
    'east-asian': '/images/companions/east-asian-slim-black.png',
    'south-asian': '/images/companions/south-asian-slim-black.png',
    'black': '/images/companions/black-slim-black.png',
    'caucasian': '/images/companions/caucasian-slim-black.png',
    'latina': '/images/companions/latina-slim-black.png',
    'middle-eastern': '/images/companions/middle-eastern-slim-black.png',
    'mixed': '/images/companions/black-athletic-black.png',
  };
  return fallbacks[ethnicity];
}

export function Step3Visuals() {
  const { visualStyle, setVisualStyle, setAppearance, nextStep } = useOnboardingStore();
  const [imageError, setImageError] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayedImage, setDisplayedImage] = useState<string | null>(null);
  const [isSurprising, setIsSurprising] = useState(false);
  const transitionTimeout = useRef<NodeJS.Timeout | null>(null);

  // Surprise Me handler
  const handleSurpriseMe = async () => {
    setIsSurprising(true);

    // Pick random values
    const targetEthnicity = ethnicityOptions[Math.floor(Math.random() * ethnicityOptions.length)].id;
    const targetBodyType = bodyTypeOptions[Math.floor(Math.random() * bodyTypeOptions.length)].id;
    const targetHairColor = hairColorOptions[Math.floor(Math.random() * hairColorOptions.length)].id;
    const targetArtStyle = artStyles[Math.floor(Math.random() * artStyles.length)].id;
    const targetBreastSize = Math.floor(Math.random() * 100);

    // Animate through options rapidly
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      setAppearance({
        ethnicity: ethnicityOptions[Math.floor(Math.random() * ethnicityOptions.length)].id,
        bodyType: bodyTypeOptions[Math.floor(Math.random() * bodyTypeOptions.length)].id,
        hairColor: hairColorOptions[Math.floor(Math.random() * hairColorOptions.length)].id,
      });
      setVisualStyle({ avatarStyle: artStyles[Math.floor(Math.random() * artStyles.length)].id as any });
      await new Promise((r) => setTimeout(r, 100 + i * 20));
    }

    // Land on final values
    setAppearance({
      ethnicity: targetEthnicity,
      bodyType: targetBodyType,
      hairColor: targetHairColor,
      breastSize: targetBreastSize,
    });
    setVisualStyle({ avatarStyle: targetArtStyle as any });

    // Wait a moment then show result
    await new Promise((r) => setTimeout(r, 500));
    setIsSurprising(false);
  };

  // Handle migration from old store format without appearance
  const appearance = visualStyle.appearance || defaultAppearance;

  // Dynamic preview image based on all appearance selections including breast size
  const previewImagePath = useMemo(() => {
    return getPreviewImagePath(appearance.ethnicity, appearance.bodyType, appearance.hairColor, appearance.breastSize);
  }, [appearance.ethnicity, appearance.bodyType, appearance.hairColor, appearance.breastSize]);

  // Legacy fallback (without breast size)
  const legacyImagePath = useMemo(() => {
    return getLegacyImagePath(appearance.ethnicity, appearance.bodyType, appearance.hairColor);
  }, [appearance.ethnicity, appearance.bodyType, appearance.hairColor]);

  const fallbackImagePath = useMemo(() => {
    return getFallbackImagePath(appearance.ethnicity);
  }, [appearance.ethnicity]);

  // Initialize displayed image
  useEffect(() => {
    if (!displayedImage) {
      setDisplayedImage(previewImagePath);
    }
  }, [displayedImage, previewImagePath]);

  // Handle image transitions with blur effect
  useEffect(() => {
    if (displayedImage && displayedImage !== previewImagePath) {
      // Start blur transition
      setIsTransitioning(true);

      // Clear any existing timeout
      if (transitionTimeout.current) {
        clearTimeout(transitionTimeout.current);
      }

      // After blur kicks in, swap the image
      transitionTimeout.current = setTimeout(() => {
        setDisplayedImage(previewImagePath);
        setImageError(false);

        // Remove blur after image loads
        setTimeout(() => {
          setIsTransitioning(false);
        }, 150);
      }, 200);
    }

    return () => {
      if (transitionTimeout.current) {
        clearTimeout(transitionTimeout.current);
      }
    };
  }, [previewImagePath, displayedImage]);

  // Reset error when selections change
  const handleSelectionChange = (updates: Partial<typeof appearance>) => {
    setAppearance(updates);
  };

  return (
    <div className="space-y-8">
      {/* Header row: Title left, Surprise Me right */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="text-left space-y-2">
          <h2 className="text-4xl font-bold font-display tracking-tight text-white">Visual Identity</h2>
          <p className="text-gray-400 max-w-md">Design your companion&apos;s physical appearance and art style.</p>
        </div>

        <Button
          size="lg"
          disabled={isSurprising}
          onClick={handleSurpriseMe}
          className="hidden lg:flex group h-16 px-12 rounded-2xl bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-cyan text-white shadow-[0_0_30px_rgba(168,85,247,0.3)] hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all font-bold text-lg relative overflow-hidden shrink-0"
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            initial={{ x: '-100%' }}
            animate={isSurprising ? { x: '100%' } : { x: '-100%' }}
            transition={isSurprising ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
          />
          <span className="relative flex items-center">
            {isSurprising ? (
              <Sparkles className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform" />
            )}
            {isSurprising ? 'Choosing...' : 'Surprise Me'}
          </span>
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left: Appearance Options */}
        <div className="lg:col-span-2 space-y-6 order-2 lg:order-1">
          {/* Ethnicity Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Ethnicity</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {ethnicityOptions.map((option) => (
                <motion.button
                  key={option.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectionChange({ ethnicity: option.id })}
                  className={cn(
                    'relative p-3 rounded-xl border text-left transition-all',
                    appearance.ethnicity === option.id
                      ? 'border-vibes-cyan bg-vibes-cyan/10 shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  {appearance.ethnicity === option.id && (
                    <div className="absolute top-2 right-2">
                      <Check className="h-4 w-4 text-vibes-cyan" />
                    </div>
                  )}
                  <div className="font-medium text-white text-sm">{option.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{option.description}</div>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Body Type Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Body Type</h3>
            <div className="flex flex-wrap gap-2">
              {bodyTypeOptions.map((option) => (
                <motion.button
                  key={option.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectionChange({ bodyType: option.id })}
                  className={cn(
                    'px-4 py-2 rounded-full border text-sm font-medium transition-all',
                    appearance.bodyType === option.id
                      ? 'border-vibes-cyan bg-vibes-cyan/10 text-vibes-cyan'
                      : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-white'
                  )}
                >
                  {option.name}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Hair Color Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Hair Color</h3>
            <div className="flex flex-wrap gap-3">
              {hairColorOptions.map((option) => (
                <motion.button
                  key={option.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleSelectionChange({ hairColor: option.id })}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-full border transition-all',
                    appearance.hairColor === option.id
                      ? 'border-vibes-cyan bg-vibes-cyan/10'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  <div className={cn('w-5 h-5 rounded-full', option.color)} />
                  <span className={cn(
                    'text-sm font-medium',
                    appearance.hairColor === option.id ? 'text-vibes-cyan' : 'text-gray-400'
                  )}>
                    {option.name}
                  </span>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Art Style Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">Art Style</h3>
            <div className="flex flex-wrap gap-3">
              {artStyles.map((style) => (
                <motion.button
                  key={style.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setVisualStyle({ avatarStyle: style.id as any })}
                  className={cn(
                    'px-5 py-2.5 rounded-full border text-sm font-bold transition-all flex items-center gap-2',
                    visualStyle.avatarStyle === style.id
                      ? 'border-vibes-electric bg-vibes-electric/10 text-vibes-electric shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                      : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-white'
                  )}
                >
                  {style.id === 'anime' && <Sparkles className="h-3.5 w-3.5" />}
                  {style.name}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Body Measurements */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">Body Measurements</h3>
              <span className="px-2 py-0.5 rounded text-[10px] bg-vibes-hot/10 text-vibes-hot font-bold border border-vibes-hot/20">NEW</span>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.01] border border-white/5 space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-bold tracking-widest uppercase text-gray-400 font-display">Breast Size</Label>
                  <span className="text-sm font-mono text-vibes-hot font-bold">{appearance.breastSize}%</span>
                </div>
                <Slider
                  value={[appearance.breastSize]}
                  onValueChange={(val) => handleSelectionChange({ breastSize: val[0] })}
                  max={100}
                  step={1}
                  className="[&_[role=slider]]:bg-vibes-hot [&_[role=slider]]:border-vibes-hot [&_.relative]:bg-white/5"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="flex flex-col items-center gap-4 order-1 lg:order-2">
          <div className="relative w-full aspect-[3/4] sm:max-w-[320px] lg:max-w-[280px] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02]">
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-vibes-cyan/5 via-transparent to-vibes-neon/5 z-10 pointer-events-none" />

            {/* Main image with blur transition */}
            <div
              className={cn(
                "absolute inset-0 transition-all duration-300 ease-out",
                isTransitioning ? "blur-md scale-105" : "blur-0 scale-100"
              )}
            >
              {displayedImage && (
                <Image
                  src={imageError ? (legacyImagePath || fallbackImagePath) : displayedImage}
                  alt="Companion preview"
                  fill
                  className="object-cover"
                  priority
                  onError={() => {
                    // Try legacy path first, then fallback
                    if (!imageError) {
                      setImageError(true);
                    }
                  }}
                />
              )}
            </div>


          </div>

          {/* Mobile Surprise Me button */}
          <Button
            size="lg"
            disabled={isSurprising}
            onClick={handleSurpriseMe}
            className="lg:hidden group w-full h-14 rounded-2xl bg-gradient-to-r from-vibes-hot via-vibes-neon to-vibes-cyan text-white shadow-[0_0_30px_rgba(168,85,247,0.3)] hover:shadow-[0_0_50px_rgba(168,85,247,0.5)] transition-all font-bold text-lg relative overflow-hidden"
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              initial={{ x: '-100%' }}
              animate={isSurprising ? { x: '100%' } : { x: '-100%' }}
              transition={isSurprising ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
            />
            <span className="relative flex items-center">
              {isSurprising ? (
                <Sparkles className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform" />
              )}
              {isSurprising ? 'Choosing...' : 'Surprise Me'}
            </span>
          </Button>
        </div>
      </div>

      <div className="flex justify-end pt-8">
        <Button
          size="lg"
          disabled={isSurprising}
          onClick={nextStep}
          className="group h-16 px-14 rounded-full bg-gradient-to-r from-vibes-cyan to-vibes-electric hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-xl disabled:opacity-50"
        >
          Next: Archetype
          <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
