'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  useOnboardingStore,
  AppearanceEthnicity,
  AppearanceHairColor,
  FemaleBodyType,
  MaleBodyType,
  CompanionGender,
  SizeCategory,
  isFemaleAppearance,
} from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Check, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { trackOnboardingStep } from '@/lib/analytics/meta-pixel';

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

const femaleBodyTypes: Array<{ id: FemaleBodyType; name: string }> = [
  { id: 'slim', name: 'Slim' },
  { id: 'athletic', name: 'Athletic' },
  { id: 'curvy', name: 'Curvy' },
  { id: 'plus-size', name: 'Plus Size' },
];

const maleBodyTypes: Array<{ id: MaleBodyType; name: string }> = [
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

const sizeOptions: SizeCategory[] = ['S', 'M', 'L'];

// Build dynamic image path based on all selections
function getPreviewImagePath(
  gender: CompanionGender,
  ethnicity: AppearanceEthnicity,
  bodyType: string,
  hairColor: AppearanceHairColor,
  size: SizeCategory
): string {
  const sizePrefix = gender === 'female' ? 'b' : 'build';
  return `/images/companions/${gender}/${ethnicity}-${bodyType}-${hairColor}-${sizePrefix}${size}.webp`;
}

// Fallback images for each ethnicity (used when specific combo doesn't exist)
function getFallbackImagePath(ethnicity: AppearanceEthnicity, gender: CompanionGender): string {
  return `/images/companions/${gender}/${ethnicity}-athletic-black-${gender === 'female' ? 'b' : 'build'}M.webp`;
}

export function Step3Visuals() {
  const { visualStyle, setAppearance, nextStep, prevStep } = useOnboardingStore();
  const [imageError, setImageError] = useState(false);
  const [displayedImage, setDisplayedImage] = useState<string | null>(null);
  const [nextImage, setNextImage] = useState<string | null>(null);
  const [isNextImageReady, setIsNextImageReady] = useState(false);
  const [isSurprising, setIsSurprising] = useState(false);
  const hasTrackedRef = useRef(false);

  // Track step on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      trackOnboardingStep(3, 'visuals', 'full');
      hasTrackedRef.current = true;
    }
  }, []);

  const appearance = visualStyle.appearance;
  const isFemale = isFemaleAppearance(appearance);
  const currentGender = appearance.gender;
  const currentSize = isFemale ? appearance.breastSize : appearance.build;
  const bodyTypeOptions = isFemale ? femaleBodyTypes : maleBodyTypes;

  // Handle gender change - reset body type to valid option for new gender
  const handleGenderChange = (newGender: CompanionGender) => {
    if (newGender === 'female') {
      setAppearance({
        gender: 'female',
        ethnicity: appearance.ethnicity,
        bodyType: 'athletic',
        hairColor: appearance.hairColor,
        breastSize: 'M',
      });
    } else {
      setAppearance({
        gender: 'male',
        ethnicity: appearance.ethnicity,
        bodyType: 'athletic',
        hairColor: appearance.hairColor,
        build: 'M',
      });
    }
  };

  // Handle size change
  const handleSizeChange = (size: SizeCategory) => {
    if (isFemale) {
      setAppearance({ ...appearance, breastSize: size });
    } else {
      setAppearance({ ...appearance, build: size });
    }
  };

  // Handle body type change
  const handleBodyTypeChange = (bodyType: string) => {
    if (isFemale) {
      setAppearance({ ...appearance, bodyType: bodyType as FemaleBodyType });
    } else {
      setAppearance({ ...appearance, bodyType: bodyType as MaleBodyType });
    }
  };

  // Surprise Me handler
  const handleSurpriseMe = async () => {
    setIsSurprising(true);

    // Pick random values
    const targetGender = Math.random() > 0.5 ? 'male' : 'female';
    const targetBodyTypes = targetGender === 'female' ? femaleBodyTypes : maleBodyTypes;
    const targetEthnicity = ethnicityOptions[Math.floor(Math.random() * ethnicityOptions.length)].id;
    const targetBodyType = targetBodyTypes[Math.floor(Math.random() * targetBodyTypes.length)].id;
    const targetHairColor = hairColorOptions[Math.floor(Math.random() * hairColorOptions.length)].id;
    const targetSize = sizeOptions[Math.floor(Math.random() * sizeOptions.length)];

    // Animate through options rapidly
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const randGender = Math.random() > 0.5 ? 'male' : 'female';
      const randBodyTypes = randGender === 'female' ? femaleBodyTypes : maleBodyTypes;
      if (randGender === 'female') {
        setAppearance({
          gender: 'female',
          ethnicity: ethnicityOptions[Math.floor(Math.random() * ethnicityOptions.length)].id,
          bodyType: randBodyTypes[Math.floor(Math.random() * randBodyTypes.length)].id as FemaleBodyType,
          hairColor: hairColorOptions[Math.floor(Math.random() * hairColorOptions.length)].id,
          breastSize: sizeOptions[Math.floor(Math.random() * sizeOptions.length)],
        });
      } else {
        setAppearance({
          gender: 'male',
          ethnicity: ethnicityOptions[Math.floor(Math.random() * ethnicityOptions.length)].id,
          bodyType: randBodyTypes[Math.floor(Math.random() * randBodyTypes.length)].id as MaleBodyType,
          hairColor: hairColorOptions[Math.floor(Math.random() * hairColorOptions.length)].id,
          build: sizeOptions[Math.floor(Math.random() * sizeOptions.length)],
        });
      }
      await new Promise((r) => setTimeout(r, 100 + i * 20));
    }

    // Land on final values
    if (targetGender === 'female') {
      setAppearance({
        gender: 'female',
        ethnicity: targetEthnicity,
        bodyType: targetBodyType as FemaleBodyType,
        hairColor: targetHairColor,
        breastSize: targetSize,
      });
    } else {
      setAppearance({
        gender: 'male',
        ethnicity: targetEthnicity,
        bodyType: targetBodyType as MaleBodyType,
        hairColor: targetHairColor,
        build: targetSize,
      });
    }

    // Wait a moment then show result
    await new Promise((r) => setTimeout(r, 500));
    setIsSurprising(false);
  };

  // Dynamic preview image based on all appearance selections
  const previewImagePath = useMemo(() => {
    return getPreviewImagePath(
      currentGender,
      appearance.ethnicity,
      appearance.bodyType,
      appearance.hairColor,
      currentSize
    );
  }, [currentGender, appearance.ethnicity, appearance.bodyType, appearance.hairColor, currentSize]);

  const fallbackImagePath = useMemo(() => {
    return getFallbackImagePath(appearance.ethnicity, currentGender);
  }, [appearance.ethnicity, currentGender]);

  // Initialize displayed image
  useEffect(() => {
    if (!displayedImage) {
      setDisplayedImage(previewImagePath);
    }
  }, [displayedImage, previewImagePath]);

  // Preload new image when selection changes
  useEffect(() => {
    if (displayedImage && displayedImage !== previewImagePath) {
      // Reset ready state and set the next image to preload
      setIsNextImageReady(false);
      setNextImage(previewImagePath);
      setImageError(false);
    }
  }, [previewImagePath, displayedImage]);

  // When next image is loaded, swap it in
  const handleNextImageLoad = () => {
    setIsNextImageReady(true);
    // Small delay to ensure the opacity transition starts from 0
    requestAnimationFrame(() => {
      setDisplayedImage(nextImage);
      setNextImage(null);
    });
  };

  return (
    <div className="space-y-8">
      {/* Header row: Title left, Surprise Me right */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="text-left space-y-2">
          <h2 className="text-4xl font-bold font-display tracking-tight text-white">Visual Identity</h2>
          <p className="text-gray-400 max-w-md">Design your companion&apos;s physical appearance.</p>
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
          {/* Gender Selection */}
          <div className="space-y-3" data-testid="gender-options">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Gender</h3>
            <div className="flex gap-3">
              {(['female', 'male'] as CompanionGender[]).map((gender) => (
                <motion.button
                  key={gender}
                  data-testid={`gender-${gender}`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleGenderChange(gender)}
                  className={cn(
                    'flex-1 p-4 rounded-xl border text-center transition-all',
                    currentGender === gender
                      ? 'border-vibes-cyan bg-vibes-cyan/10 shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  <div className="text-2xl mb-1">{gender === 'female' ? '♀' : '♂'}</div>
                  <div className="font-medium text-white capitalize">{gender}</div>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Ethnicity Selection */}
          <div className="space-y-3" data-testid="ethnicity-options">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Ethnicity</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {ethnicityOptions.map((option) => (
                <motion.button
                  key={option.id}
                  data-testid={`ethnicity-${option.id}`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setAppearance({ ...appearance, ethnicity: option.id })}
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
          <div className="space-y-3" data-testid="body-type-options">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Body Type</h3>
            <div className="flex flex-wrap gap-2">
              {bodyTypeOptions.map((option) => (
                <motion.button
                  key={option.id}
                  data-testid={`body-type-${option.id}`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleBodyTypeChange(option.id)}
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
          <div className="space-y-3" data-testid="hair-color-options">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500">Hair Color</h3>
            <div className="flex flex-wrap gap-3">
              {hairColorOptions.map((option) => (
                <motion.button
                  key={option.id}
                  data-testid={`hair-color-${option.id}`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setAppearance({ ...appearance, hairColor: option.id })}
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

          {/* Body Measurements - S/M/L buttons */}
          <div className="space-y-4 pt-4 border-t border-white/5" data-testid="size-options">
            <h3 className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              {isFemale ? 'Figure' : 'Build'}
            </h3>
            <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/5">
              <div className="flex gap-2">
                {sizeOptions.map((size) => (
                  <motion.button
                    key={size}
                    data-testid={`size-${size}`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSizeChange(size)}
                    className={cn(
                      'flex-1 py-3 rounded-xl border text-center font-bold text-lg transition-all',
                      currentSize === size
                        ? 'border-vibes-hot bg-vibes-hot/10 text-vibes-hot shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                        : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-white'
                    )}
                  >
                    {size}
                  </motion.button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3 text-center">
                {isFemale
                  ? 'Affects overall figure proportions'
                  : 'Affects chest and shoulder width'}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="flex flex-col items-center gap-4 order-1 lg:order-2">
          <div className="relative w-full aspect-[3/4] sm:max-w-[320px] lg:max-w-[280px] rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02]">
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-vibes-cyan/5 via-transparent to-vibes-neon/5 z-10 pointer-events-none" />

            {/* Current displayed image */}
            {displayedImage && (
              <Image
                src={imageError ? fallbackImagePath : displayedImage}
                alt="Companion preview"
                fill
                className="object-cover"
                priority
                onError={() => {
                  if (!imageError) {
                    setImageError(true);
                  }
                }}
              />
            )}

            {/* Preloading next image - fades in on top when ready */}
            {nextImage && (
              <Image
                src={nextImage}
                alt="Companion preview loading"
                fill
                className={cn(
                  "object-cover transition-opacity duration-200 ease-out",
                  isNextImageReady ? "opacity-100" : "opacity-0"
                )}
                onLoad={handleNextImageLoad}
                onError={() => {
                  // If next image fails, use fallback
                  setImageError(true);
                  setDisplayedImage(fallbackImagePath);
                  setNextImage(null);
                }}
              />
            )}
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

      <div className="flex justify-between pt-8">
        <Button
          variant="ghost"
          size="lg"
          onClick={prevStep}
          className="group h-16 px-6 rounded-full text-gray-400 hover:text-white transition-all font-bold text-xl"
        >
          <ArrowLeft className="mr-2 h-6 w-6 group-hover:-translate-x-2 transition-transform duration-300" />
          Back
        </Button>
        <Button
          size="lg"
          disabled={isSurprising}
          onClick={nextStep}
          data-testid="next-to-archetype"
          className="group h-16 px-14 rounded-full bg-gradient-to-r from-vibes-cyan to-vibes-electric hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-xl disabled:opacity-50"
        >
          Next: Archetype
          <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-2 transition-transform duration-300" />
        </Button>
      </div>
    </div>
  );
}
