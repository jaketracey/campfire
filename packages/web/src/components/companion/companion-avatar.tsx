'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  generateCompanionImage,
  type ImageGenRequest,
  type EmotionalState,
  type PersonalitySliders,
} from '@/lib/api/imagegen';

interface CompanionAvatarProps {
  /** The current emotional state of the companion */
  emotionalState?: EmotionalState;
  /** Personality sliders affecting the avatar */
  personality?: PersonalitySliders;
  /** Visual style for the avatar */
  style?: 'realistic' | 'stylized' | 'abstract' | 'minimal' | 'anime';
  /** Custom base prompt override */
  customPrompt?: string;
  /** Width of the avatar in pixels */
  width?: number;
  /** Height of the avatar in pixels */
  height?: number;
  /** Additional className */
  className?: string;
  /** Whether to show loading skeleton */
  showSkeleton?: boolean;
  /** Callback when image is loaded */
  onLoad?: (imageUrl: string, cacheKey: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Use a specific cached image */
  cacheKey?: string;
  /** Fallback image URL */
  fallbackUrl?: string;
  /** Enable auto-regeneration on state changes */
  autoRegenerate?: boolean;
  /** Debounce delay for regeneration in ms */
  debounceDelay?: number;
  /** User ID for S3 persistence */
  userId?: string;
  /** Session ID for S3 persistence */
  sessionId?: string;
  /** Companion ID for tracking */
  companionId?: string;
  /** Reference image URL for character consistency (IP-Adapter) */
  referenceImageUrl?: string;
  /** How strongly to follow the reference (0.0-1.0, default 0.7) */
  referenceStrength?: number;
}

export function CompanionAvatar({
  emotionalState = 'neutral',
  personality,
  style = 'stylized',
  customPrompt,
  width = 250,
  height = 400,
  className,
  showSkeleton = true,
  onLoad,
  onError,
  cacheKey: initialCacheKey,
  fallbackUrl,
  autoRegenerate = true,
  debounceDelay = 1000,
  userId,
  sessionId,
  companionId,
  referenceImageUrl: externalReferenceUrl,
  referenceStrength = 0.7,
}: CompanionAvatarProps) {
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(fallbackUrl || null);
  const [nextImageUrl, setNextImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentCacheKey, setCurrentCacheKey] = useState<string | null>(initialCacheKey || null);
  // Store the first generated S3 URL as identity anchor for character consistency
  const [identityAnchorUrl, setIdentityAnchorUrl] = useState<string | null>(externalReferenceUrl || null);

  const generateImage = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      // Require explicit prompt - no fallback to generic prompt
      // This helps debug issues where companion visual style isn't being passed
      if (!customPrompt) {
        throw new Error(
          'CompanionAvatar: customPrompt is required. ' +
          'Check that companion.spec.visual_style exists and buildPromptFromCompanion is working.'
        );
      }

      const request: ImageGenRequest = {
        prompt: customPrompt,
        emotionalState,
        personality,
        style,
        width,
        height,
        cacheKey: initialCacheKey,
        userId,
        sessionId,
        companionId,
        saveToS3: !!(userId && sessionId),
        // Use identity anchor for character consistency (IP-Adapter)
        referenceImageUrl: identityAnchorUrl || undefined,
        referenceStrength: identityAnchorUrl ? referenceStrength : undefined,
      };

      const result = await generateCompanionImage(request);

      // If this is the first successful generation with S3, use it as identity anchor
      if (!identityAnchorUrl && result.s3Key && result.imageUrl) {
        setIdentityAnchorUrl(result.imageUrl);
      }

      // If we already have an image, do a crossfade
      if (currentImageUrl && result.imageUrl !== currentImageUrl) {
        setNextImageUrl(result.imageUrl);
        setIsTransitioning(true);

        // After transition completes, swap the images
        setTimeout(() => {
          setCurrentImageUrl(result.imageUrl);
          setNextImageUrl(null);
          setIsTransitioning(false);
        }, 500); // Match the fade duration
      } else {
        setCurrentImageUrl(result.imageUrl);
      }

      setCurrentCacheKey(result.cacheKey);
      onLoad?.(result.imageUrl, result.cacheKey);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to generate image');
      setError(error);
      onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [
    customPrompt,
    style,
    emotionalState,
    personality,
    width,
    height,
    initialCacheKey,
    currentImageUrl,
    isLoading,
    onLoad,
    onError,
    userId,
    sessionId,
    companionId,
    identityAnchorUrl,
    referenceStrength,
  ]);

  // Auto-regenerate when emotional state or personality changes
  useEffect(() => {
    if (!autoRegenerate) return;

    const timer = setTimeout(() => {
      generateImage();
    }, debounceDelay);

    return () => clearTimeout(timer);
  }, [emotionalState, personality, style, autoRegenerate, debounceDelay, generateImage]);

  // Initial load
  useEffect(() => {
    if (!currentImageUrl && !isLoading) {
      generateImage();
    }
  }, []); // Only run once on mount

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-gradient-to-b from-primary/5 to-primary/10',
        className
      )}
      style={{ width, height }}
    >
      {/* Loading skeleton */}
      {showSkeleton && isLoading && !currentImageUrl && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-muted/50 to-muted/80">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        </div>
      )}

      {/* Current image with fade transitions */}
      <AnimatePresence mode="sync">
        {currentImageUrl && (
          <motion.img
            key={currentImageUrl}
            src={currentImageUrl}
            alt="Companion Avatar"
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: isTransitioning ? 0.5 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />
        )}
      </AnimatePresence>

      {/* Next image (for crossfade) */}
      <AnimatePresence mode="sync">
        {nextImageUrl && isTransitioning && (
          <motion.img
            key={nextImageUrl}
            src={nextImageUrl}
            alt="Companion Avatar (transitioning)"
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />
        )}
      </AnimatePresence>

      {/* Loading overlay for regeneration */}
      <AnimatePresence>
        {isLoading && currentImageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          >
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-white border-t-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error state */}
      {error && !currentImageUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive">Failed to generate avatar</p>
          <button
            onClick={generateImage}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Emotional state indicator */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
          {emotionalState}
        </span>
        {currentCacheKey && (
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
            {currentCacheKey.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Static companion avatar that doesn't auto-regenerate
 * Useful for displaying saved/cached images
 */
export function StaticCompanionAvatar({
  imageUrl,
  width = 250,
  height = 400,
  className,
  emotionalState,
}: {
  imageUrl: string;
  width?: number;
  height?: number;
  className?: string;
  emotionalState?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-gradient-to-b from-primary/5 to-primary/10',
        className
      )}
      style={{ width, height }}
    >
      <motion.img
        src={imageUrl}
        alt="Companion Avatar"
        className="h-full w-full object-cover"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
      />
      {emotionalState && (
        <div className="absolute bottom-2 left-2">
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
            {emotionalState}
          </span>
        </div>
      )}
    </div>
  );
}
