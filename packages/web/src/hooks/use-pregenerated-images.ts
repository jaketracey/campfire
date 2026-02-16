'use client';

import { useState, useEffect } from 'react';

export interface PregeneratedImage {
  name: string;
  path: string;
  emotionalState: string;
  style: string;
}

export interface PregeneratedImageIndex {
  marketing: PregeneratedImage[];
  onboarding: PregeneratedImage[];
}

/**
 * Hook to load and access pre-generated companion images
 * Falls back to dynamic generation if images aren't available
 */
export function usePregeneratedImages() {
  const [index, setIndex] = useState<PregeneratedImageIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function loadIndex() {
      try {
        const response = await fetch('/generated/index.json');
        if (response.ok) {
          const data = await response.json();
          setIndex(data);
        } else {
          setError(new Error('Pre-generated images not available'));
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load index'));
      } finally {
        setIsLoading(false);
      }
    }

    loadIndex();
  }, []);

  /**
   * Get a pre-generated image by emotional state
   */
  function getByEmotionalState(
    emotionalState: string,
    style?: string
  ): PregeneratedImage | null {
    if (!index) return null;

    const images = index.onboarding.filter(
      (img) =>
        img.emotionalState === emotionalState &&
        (!style || img.style === style)
    );

    return images[0] || null;
  }

  /**
   * Get a pre-generated image by style
   */
  function getByStyle(style: string): PregeneratedImage | null {
    if (!index) return null;

    const images = index.onboarding.filter(
      (img) => img.style === style && img.emotionalState === 'neutral'
    );

    return images[0] || null;
  }

  /**
   * Get all available emotional state images
   */
  function getAllEmotionalStates(): PregeneratedImage[] {
    if (!index) return [];
    return index.onboarding.filter((img) => img.name.startsWith('emotion-'));
  }

  /**
   * Get marketing images
   */
  function getMarketingImages(): PregeneratedImage[] {
    if (!index) return [];
    return index.marketing;
  }

  return {
    index,
    isLoading,
    error,
    getByEmotionalState,
    getByStyle,
    getAllEmotionalStates,
    getMarketingImages,
    hasPregenerated: !!index && !error,
  };
}

/**
 * Get the URL for a pre-generated emotional state image
 */
export function getEmotionalStateImageUrl(emotionalState: string): string {
  return `/generated/emotion-${emotionalState}.webp`;
}

/**
 * Get the URL for a pre-generated style preview image
 */
export function getStylePreviewUrl(style: string): string {
  return `/generated/preview-${style}-neutral.webp`;
}
