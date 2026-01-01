'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  generateCompanionImage,
  getBasePrompt,
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
  /** Anchor image URL to show initially (skips initial generation) */
  anchorImageUrl?: string;
  /** Generation counter - increment to trigger new generation */
  generationTrigger?: number;
  /** Scene/action description from LLM for contextual image generation */
  sceneDescription?: string;
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
  autoRegenerate = false, // Default to false - only generate when explicitly triggered
  debounceDelay = 1000,
  userId,
  sessionId,
  companionId,
  referenceImageUrl: externalReferenceUrl,
  referenceStrength = 0.85,
  anchorImageUrl,
  generationTrigger = 0,
  sceneDescription,
}: CompanionAvatarProps) {
  // Use anchor image as initial display (no generation needed on mount)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(anchorImageUrl || fallbackUrl || null);
  const [nextImageUrl, setNextImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentCacheKey, setCurrentCacheKey] = useState<string | null>(initialCacheKey || null);
  // Use anchor image as identity reference for IP-Adapter character consistency
  const [identityAnchorUrl, setIdentityAnchorUrl] = useState<string | null>(anchorImageUrl || externalReferenceUrl || null);
  // Track generation trigger to only generate when explicitly requested
  // Using a ref instead of state to prevent re-renders from clearing the timeout
  const lastGenerationTriggerRef = useRef(0);

  // Sync anchor image when prop changes (e.g., when companion data loads)
  useEffect(() => {
    if (anchorImageUrl) {
      // Only set if we don't have a current image yet (avoid overwriting generated images)
      if (!currentImageUrl) {
        setCurrentImageUrl(anchorImageUrl);
      }
      // Always update identity anchor for IP-Adapter reference
      if (!identityAnchorUrl) {
        setIdentityAnchorUrl(anchorImageUrl);
      }
    }
  }, [anchorImageUrl, currentImageUrl, identityAnchorUrl]);

  const generateImage = useCallback(async () => {
    console.log('[CompanionAvatar] generateImage called, isLoading:', isLoading);
    if (isLoading) {
      console.log('[CompanionAvatar] Skipping generation - already loading');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Build prompt: base character + scene description from LLM
      let promptToUse = customPrompt || getBasePrompt(style);

      // Add scene/action description from LLM response if provided
      if (sceneDescription) {
        promptToUse = `${promptToUse}, ${sceneDescription}`;
      }

      const request: ImageGenRequest = {
        prompt: promptToUse,
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
        // Let the gateway fetch a fresh presigned URL for the identity anchor
        // This avoids 403 errors from expired presigned URLs
        referenceStrength: companionId ? referenceStrength : undefined,
      };

      console.log('[CompanionAvatar] Generating image with request:', {
        prompt: promptToUse.slice(0, 100) + '...',
        emotionalState,
        companionId,
        referenceStrength: request.referenceStrength,
        userId,
        sessionId,
      });

      console.log('[CompanionAvatar] Calling generateCompanionImage API...');
      const startTime = Date.now();
      const result = await generateCompanionImage(request);
      console.log('[CompanionAvatar] API call completed in', Date.now() - startTime, 'ms');

      console.log('[CompanionAvatar] Image generated:', {
        imageUrl: result.imageUrl?.slice(0, 50),
        latencyMs: result.latencyMs,
        cached: result.cached,
      });

      // If this is the first successful generation with S3, use it as identity anchor
      if (!identityAnchorUrl && result.s3Key && result.imageUrl) {
        setIdentityAnchorUrl(result.imageUrl);
      }

      // If we already have an image, do a crossfade
      if (currentImageUrl && result.imageUrl !== currentImageUrl) {
        console.log('[CompanionAvatar] Starting crossfade transition', {
          currentImageUrl: currentImageUrl?.slice(0, 50),
          newImageUrl: result.imageUrl?.slice(0, 50),
        });
        setNextImageUrl(result.imageUrl);
        setIsTransitioning(true);

        // After transition completes, swap the images
        setTimeout(() => {
          console.log('[CompanionAvatar] Crossfade timeout fired, swapping images');
          setCurrentImageUrl(result.imageUrl);
          setNextImageUrl(null);
          setIsTransitioning(false);
          console.log('[CompanionAvatar] Crossfade complete');
        }, 500); // Match the fade duration
      } else {
        console.log('[CompanionAvatar] No crossfade needed, setting image directly', {
          hadPreviousImage: !!currentImageUrl,
          newImageUrl: result.imageUrl?.slice(0, 50),
        });
        setCurrentImageUrl(result.imageUrl);
      }

      setCurrentCacheKey(result.cacheKey);
      onLoad?.(result.imageUrl, result.cacheKey);
    } catch (err) {
      console.error('[CompanionAvatar] Image generation failed:', err);
      const error = err instanceof Error ? err : new Error('Failed to generate image');
      setError(error);
      onError?.(error);
    } finally {
      console.log('[CompanionAvatar] generateImage finished, setting isLoading=false');
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
    sceneDescription,
  ]);

  // Generate when generationTrigger increments (after LLM response)
  useEffect(() => {
    // Use ref to track last trigger without causing re-renders that clear the timeout
    if (generationTrigger > lastGenerationTriggerRef.current) {
      console.log('[CompanionAvatar] Generation triggered:', {
        generationTrigger,
        lastGenerationTrigger: lastGenerationTriggerRef.current,
        sceneDescription,
        identityAnchorUrl: identityAnchorUrl?.slice(0, 50),
      });
      // Update ref immediately (doesn't cause re-render)
      lastGenerationTriggerRef.current = generationTrigger;
      const timer = setTimeout(() => {
        console.log('[CompanionAvatar] Starting image generation...');
        generateImage();
      }, debounceDelay);
      return () => clearTimeout(timer);
    }
  }, [generationTrigger, debounceDelay, generateImage, sceneDescription, identityAnchorUrl]);

  // Legacy: Auto-regenerate on emotional state changes (if enabled)
  useEffect(() => {
    if (!autoRegenerate) return;
    // Skip if we have an anchor and haven't started generating yet
    if (anchorImageUrl && lastGenerationTriggerRef.current === 0) return;

    const timer = setTimeout(() => {
      generateImage();
    }, debounceDelay);

    return () => clearTimeout(timer);
  }, [emotionalState, personality, style, autoRegenerate, debounceDelay, generateImage, anchorImageUrl]);

  // Initial load - only if no anchor image provided
  useEffect(() => {
    if (!currentImageUrl && !isLoading && !anchorImageUrl) {
      generateImage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* Current image - always visible, opacity controlled by isTransitioning */}
      {currentImageUrl && (
        <motion.img
          key="current-image"
          src={currentImageUrl}
          alt="Companion Avatar"
          className="absolute inset-0 h-full w-full object-cover"
          animate={{ opacity: isTransitioning ? 0 : 1 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />
      )}

      {/* Next image (for crossfade) - fades in on top, then becomes current */}
      <AnimatePresence>
        {nextImageUrl && isTransitioning && (
          <motion.img
            key={nextImageUrl}
            src={nextImageUrl}
            alt="Companion Avatar (transitioning)"
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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
}: {
  imageUrl: string;
  width?: number;
  height?: number;
  className?: string;
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
    </div>
  );
}
