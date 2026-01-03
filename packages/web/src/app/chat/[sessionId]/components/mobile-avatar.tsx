'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { LikeHeartsAnimation } from '@/components/likes/like-hearts-animation';
import type { GalleryImage } from '@/lib/api/imagegen';
import type { SignupTrigger } from '@/components/demo/signup-modal';

interface MobileAvatarProps {
  currentAvatarUrl: string | null;
  companionName: string;
  showMobileAvatar: boolean;
  onToggleMobileAvatar: () => void;
  keyboardHeight: number;
  mobileAvatarPop: boolean;
  likeAnimationTrigger: number;

  // Gallery
  mobileGalleryImages: GalleryImage[];
  mobileGalleryIndex: number;
  onGalleryIndexChange: (index: number) => void;
  mobileGalleryLoading: boolean;

  // Demo mode
  isDemo?: boolean;
  onRequireAuth?: (trigger: SignupTrigger) => void;
}

export function MobileAvatar({
  currentAvatarUrl,
  companionName,
  showMobileAvatar,
  onToggleMobileAvatar,
  keyboardHeight,
  mobileAvatarPop,
  likeAnimationTrigger,
  mobileGalleryImages,
  mobileGalleryIndex,
  onGalleryIndexChange,
  mobileGalleryLoading,
  isDemo,
  onRequireAuth,
}: MobileAvatarProps) {
  if (!currentAvatarUrl) {
    return null;
  }

  const handleSwipe = (direction: 'left' | 'right') => {
    if (isDemo && onRequireAuth) {
      onRequireAuth('gallery');
      return;
    }

    if (direction === 'left' && mobileGalleryIndex < mobileGalleryImages.length - 1) {
      onGalleryIndexChange(mobileGalleryIndex + 1);
    } else if (direction === 'right' && mobileGalleryIndex > 0) {
      onGalleryIndexChange(mobileGalleryIndex - 1);
    }
  };

  return (
    <>
      {/* Backdrop when expanded */}
      <AnimatePresence>
        {showMobileAvatar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm"
            onClick={onToggleMobileAvatar}
          />
        )}
      </AnimatePresence>

      {/* Avatar container - expands in place */}
      <motion.div
        layoutId="mobile-avatar"
        onClick={onToggleMobileAvatar}
        className={`lg:hidden fixed z-50 rounded-xl overflow-hidden border-2 border-campfire-500 shadow-xl bg-muted cursor-pointer ${
          showMobileAvatar
            ? 'inset-4 top-16 bottom-auto max-h-[70vh]'
            : 'right-4 w-[120px] h-[144px]'
        }`}
        style={!showMobileAvatar ? { bottom: keyboardHeight > 0 ? `${keyboardHeight + 150}px` : '150px' } : undefined}
        animate={!showMobileAvatar ? { scale: mobileAvatarPop ? 1.15 : 1 } : undefined}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        {/* Swipeable gallery when expanded */}
        {showMobileAvatar ? (
          <motion.div
            className="w-full h-full"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              const swipeThreshold = 50;
              if (info.offset.x < -swipeThreshold) {
                handleSwipe('left');
              } else if (info.offset.x > swipeThreshold) {
                handleSwipe('right');
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <AnimatePresence mode="wait">
              <motion.img
                key={mobileGalleryIndex}
                src={mobileGalleryImages.length > 0 && mobileGalleryImages[mobileGalleryIndex]
                  ? mobileGalleryImages[mobileGalleryIndex].s3_url
                  : currentAvatarUrl}
                alt={companionName}
                className="w-full h-full object-cover"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                draggable={false}
              />
            </AnimatePresence>

            {/* Close button */}
            <button
              onClick={onToggleMobileAvatar}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Navigation arrows */}
            {mobileGalleryImages.length > 1 && mobileGalleryIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onGalleryIndexChange(mobileGalleryIndex - 1);
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {mobileGalleryImages.length > 1 && mobileGalleryIndex < mobileGalleryImages.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onGalleryIndexChange(mobileGalleryIndex + 1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}

            {/* Dot indicators */}
            {mobileGalleryImages.length > 1 && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
                {mobileGalleryImages.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      onGalleryIndexChange(idx);
                    }}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      idx === mobileGalleryIndex
                        ? 'bg-campfire-500'
                        : 'bg-white/40 hover:bg-white/60'
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Companion name overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
              <p className="text-white text-lg font-semibold">
                {companionName}
                {mobileGalleryImages.length > 0 && mobileGalleryImages[mobileGalleryIndex] && (
                  <span className="ml-2 text-white/70 text-base capitalize font-normal">
                    • {mobileGalleryImages[mobileGalleryIndex].emotional_state}
                  </span>
                )}
              </p>
            </div>

            {/* Loading state */}
            {mobileGalleryLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="w-8 h-8 border-2 border-campfire-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </motion.div>
        ) : (
          <img
            src={currentAvatarUrl}
            alt={companionName}
            className="w-full h-full object-cover"
          />
        )}
        <LikeHeartsAnimation trigger={likeAnimationTrigger} />
      </motion.div>
    </>
  );
}
