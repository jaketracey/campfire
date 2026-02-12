'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  generateCompanionImage,
  getBasePrompt,
  type ImageGenRequest,
  type EmotionalState,
  type PersonalitySliders,
} from '@/lib/api/imagegen';
import { getOptimalAvatarUrl, type ImageRenditions } from '@/lib/utils/image-renditions';

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
  onLoad?: (imageUrl: string, cacheKey: string, turnId?: string) => void;
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
  /** Renditions of the anchor image for optimized delivery */
  anchorRenditions?: ImageRenditions | null;
  /** Generation counter - increment to trigger new generation */
  generationTrigger?: number;
  /** Scene/action description from LLM for contextual image generation */
  sceneDescription?: string;
  /** Turn ID that the generated image corresponds to */
  turnId?: string;
}

export function CompanionAvatar({
  emotionalState = 'neutral',
  personality,
  style = 'stylized',
  customPrompt,
  width = 512,
  height = 768,
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
  anchorRenditions,
  generationTrigger = 0,
  sceneDescription,
  turnId,
}: CompanionAvatarProps) {
  // Compute optimal anchor URL using renditions if available
  // Uses 'large' rendition for chat view (832x1248 → ~200KB vs 6MB original)
  const optimalAnchorUrl = useMemo(
    () => getOptimalAvatarUrl(anchorImageUrl, anchorRenditions, width),
    [anchorImageUrl, anchorRenditions, width]
  );

  // Use anchor image as initial display (no generation needed on mount)
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(optimalAnchorUrl || fallbackUrl || null);
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
  const generationSequenceRef = useRef(0);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync anchor image when prop changes (e.g., when companion data loads)
  useEffect(() => {
    if (optimalAnchorUrl) {
      // Only set if we don't have a current image yet (avoid overwriting generated images)
      if (!currentImageUrl) {
        setCurrentImageUrl(optimalAnchorUrl);
      }
    }
    // Always update identity anchor for IP-Adapter reference (use original URL for best quality)
    if (anchorImageUrl && !identityAnchorUrl) {
      setIdentityAnchorUrl(anchorImageUrl);
    }
  }, [optimalAnchorUrl, anchorImageUrl, currentImageUrl, identityAnchorUrl]);

  const generateImage = useCallback(async () => {
    const generationId = generationSequenceRef.current + 1;
    generationSequenceRef.current = generationId;

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
      setIsTransitioning(false);
      setNextImageUrl(null);
    }

    inFlightControllerRef.current?.abort();
    const controller = new AbortController();
    inFlightControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      // Build prompt: use companion's imagePrompt directly if available.
      // Fallback to baseline portrait prompt for backwards compatibility.
      const promptToUse = sceneDescription || customPrompt || getBasePrompt(style);

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
        turnId,
        companionId,
        saveToS3: !!(userId && sessionId),
        // Let the gateway select an anchor; avoids client-side URL expiry issues.
        referenceStrength: companionId ? referenceStrength : undefined,
      };

      const startTime = Date.now();
      const result = await generateCompanionImage(request, { signal: controller.signal });
      console.log('[CompanionAvatar] API call completed in', Date.now() - startTime, 'ms');

      // Ignore stale responses from cancelled/replaced generations.
      if (generationSequenceRef.current !== generationId) {
        return;
      }

      if (!identityAnchorUrl && result.s3Key && result.imageUrl) {
        setIdentityAnchorUrl(result.imageUrl);
      }

      // Preload the image before showing transition to avoid flashes.
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to preload image'));
        img.src = result.imageUrl;
      });

      if (generationSequenceRef.current !== generationId) {
        return;
      }

      if (currentImageUrl && result.imageUrl !== currentImageUrl) {
        setNextImageUrl(result.imageUrl);
        setIsTransitioning(true);

        transitionTimeoutRef.current = setTimeout(() => {
          if (generationSequenceRef.current !== generationId) {
            return;
          }
          setCurrentImageUrl(result.imageUrl);
          setNextImageUrl(null);
          setIsTransitioning(false);
          transitionTimeoutRef.current = null;
        }, 500);
      } else {
        setCurrentImageUrl(result.imageUrl);
      }

      setCurrentCacheKey(result.cacheKey);
      onLoad?.(result.imageUrl, result.cacheKey, turnId);
    } catch (err) {
      const isAbortError = err instanceof Error && err.name === 'AbortError';
      if (!isAbortError && generationSequenceRef.current === generationId) {
        console.error('[CompanionAvatar] Image generation failed:', err);
        const error = err instanceof Error ? err : new Error('Failed to generate image');
        setError(error);
        onError?.(error);
      }
    } finally {
      if (inFlightControllerRef.current === controller) {
        inFlightControllerRef.current = null;
      }
      if (generationSequenceRef.current === generationId) {
        setIsLoading(false);
      }
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
    onLoad,
    onError,
    userId,
    sessionId,
    turnId,
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
    if (optimalAnchorUrl && lastGenerationTriggerRef.current === 0) return;

    const timer = setTimeout(() => {
      generateImage();
    }, debounceDelay);

    return () => clearTimeout(timer);
  }, [emotionalState, personality, style, autoRegenerate, debounceDelay, generateImage, optimalAnchorUrl]);

  useEffect(() => {
    return () => {
      inFlightControllerRef.current?.abort();
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Initial load - only if no anchor image provided
  useEffect(() => {
    if (!currentImageUrl && !isLoading && !optimalAnchorUrl) {
      generateImage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Skip inline dimensions if className includes size utilities (w-full, h-full)
  // This allows parent containers to control the display size while we generate at higher res
  const useInlineDimensions = !className?.includes('w-full') && !className?.includes('h-full');

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-gradient-to-b from-primary/5 to-primary/10',
        className
      )}
      style={useInlineDimensions ? { width, height } : undefined}
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
  width = 512,
  height = 768,
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
