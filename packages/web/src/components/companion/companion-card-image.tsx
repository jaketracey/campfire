'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface CompanionCardImageProps {
  /** Array of image URLs specific to this companion (conversation images, avatar, etc.) */
  images: (string | null)[];
  /** Fallback image to show if no companion-specific images exist */
  fallbackImage?: string | null;
  alt: string;
  className?: string;
}

export function CompanionCardImage({ images, fallbackImage, alt, className = '' }: CompanionCardImageProps) {
  // Filter out null/undefined and duplicate images - only companion-specific images
  const validImages = [...new Set(images.filter((img): img is string => !!img))];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set([0]));
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Preload the next image
  const preloadNextImage = useCallback((nextIndex: number) => {
    if (loadedImages.has(nextIndex) || nextIndex >= validImages.length) return;

    const img = new Image();
    img.src = validImages[nextIndex];

    img.onload = () => {
      setLoadedImages(prev => new Set([...prev, nextIndex]));
    };
  }, [validImages, loadedImages]);

  // Handle hover cycling
  useEffect(() => {
    if (!isHovering || validImages.length <= 1) return;

    // Start preloading next image immediately on hover
    const nextIndex = (currentIndex + 1) % validImages.length;
    preloadNextImage(nextIndex);

    // Set up interval for cycling
    intervalRef.current = setInterval(() => {
      setCurrentIndex(prev => {
        const nextIdx = (prev + 1) % validImages.length;

        // Only transition if next image is loaded
        if (loadedImages.has(nextIdx)) {
          setIsTransitioning(true);
          setTimeout(() => {
            setIsTransitioning(false);
            // Preload the next one
            const afterNext = (nextIdx + 1) % validImages.length;
            preloadNextImage(afterNext);
          }, 300);
          return nextIdx;
        } else {
          // Keep trying to preload
          preloadNextImage(nextIdx);
          return prev;
        }
      });
    }, 2500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isHovering, validImages.length, loadedImages, preloadNextImage, currentIndex]);

  // Reset on mouse leave
  const handleMouseLeave = () => {
    setIsHovering(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    // Reset to first image with transition
    if (currentIndex !== 0) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex(0);
        setIsTransitioning(false);
      }, 300);
    }
  };

  // Use fallback if no valid companion images
  const displayImage = validImages.length > 0 ? validImages[currentIndex] : fallbackImage;

  if (!displayImage) {
    return (
      <div className={`w-full h-full bg-gradient-to-br from-campfire-500/20 via-campfire-600/10 to-campfire-700/20 ${className}`} />
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleMouseLeave}
    >
      <img
        src={displayImage}
        alt={alt}
        className={`w-full h-full object-cover object-top transition-all duration-500 ${
          isTransitioning ? 'blur-sm scale-105 opacity-80' : 'blur-0 scale-100 opacity-100'
        } group-hover:scale-110`}
      />

      {/* Image indicator dots - only show if multiple images and hovering */}
      {validImages.length > 1 && isHovering && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {validImages.map((_, idx) => (
            <div
              key={idx}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                idx === currentIndex
                  ? 'bg-white scale-125'
                  : loadedImages.has(idx)
                    ? 'bg-white/50'
                    : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
