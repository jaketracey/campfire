'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Maximize2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getSessionGallery, type GalleryImage } from '@/lib/api/imagegen';
import { StaticCompanionAvatar } from './companion-avatar';

interface CompanionGalleryProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CompanionGallery({ sessionId, isOpen, onClose }: CompanionGalleryProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && sessionId) {
      loadGallery();
    }
  }, [isOpen, sessionId]);

  async function loadGallery() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getSessionGallery(sessionId);
      setImages(response.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gallery');
    } finally {
      setIsLoading(false);
    }
  }

  function handlePrevious() {
    if (selectedIndex === null || selectedIndex === 0) return;
    setSelectedIndex(selectedIndex - 1);
  }

  function handleNext() {
    if (selectedIndex === null || selectedIndex >= images.length - 1) return;
    setSelectedIndex(selectedIndex + 1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (selectedIndex !== null) {
      if (e.key === 'ArrowLeft') handlePrevious();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'Escape') setSelectedIndex(null);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  async function handleDownload(image: GalleryImage) {
    try {
      const response = await fetch(image.s3_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `companion-${image.emotional_state}-${image.cache_key.slice(0, 8)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      console.error('Failed to download image');
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-6 w-6" />
      </Button>

      {/* Gallery container */}
      <div className="flex h-full w-full max-w-6xl flex-col p-8">
        <h2 className="mb-6 text-2xl font-semibold text-white">Companion Gallery</h2>

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="text-red-400">{error}</p>
            <Button variant="outline" onClick={loadGallery}>
              Try again
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && images.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-white/60">No images generated yet. Chat with your companion to create memories!</p>
          </div>
        )}

        {/* Grid of images */}
        {!isLoading && !error && images.length > 0 && (
          <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {images.map((image, index) => (
              <motion.div
                key={image.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                className="group relative cursor-pointer"
                onClick={() => setSelectedIndex(index)}
              >
                <div className="aspect-[5/8] overflow-hidden rounded-lg bg-white/10">
                  <img
                    src={image.s3_url}
                    alt={`Companion - ${image.emotional_state}`}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </div>
                {/* Overlay with info */}
                <div className="absolute inset-0 flex flex-col justify-end rounded-lg bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-xs font-medium text-white capitalize">
                    {image.emotional_state}
                  </span>
                  <span className="text-[10px] text-white/60">
                    {new Date(image.created_at).toLocaleDateString()}
                  </span>
                </div>
                {/* Expand icon */}
                <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 className="h-4 w-4 text-white drop-shadow-md" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox for selected image */}
      <AnimatePresence>
        {selectedIndex !== null && images[selectedIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/90"
            onClick={() => setSelectedIndex(null)}
          >
            {/* Navigation */}
            {selectedIndex > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevious();
                }}
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
            )}
            {selectedIndex < images.length - 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            )}

            {/* Image */}
            <motion.div
              key={selectedIndex}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative max-h-[80vh] max-w-[80vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={images[selectedIndex].s3_url}
                alt={`Companion - ${images[selectedIndex].emotional_state}`}
                className="max-h-[80vh] rounded-lg object-contain"
              />
              {/* Info bar */}
              <div className="mt-4 flex items-center justify-between">
                <div className="text-white">
                  <p className="font-medium capitalize">{images[selectedIndex].emotional_state}</p>
                  <p className="text-sm text-white/60">
                    {new Date(images[selectedIndex].created_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => handleDownload(images[selectedIndex])}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </motion.div>

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 text-white hover:bg-white/20"
              onClick={() => setSelectedIndex(null)}
            >
              <X className="h-6 w-6" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
