'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

interface LipSyncPlayerProps {
  /** Static companion avatar image URL (shown when no video) */
  companionAvatarUrl: string;
  /** Lip-synced video URL (when available, plays on top of avatar) */
  videoUrl: string | null;
  /** Whether a lip-sync video is currently being generated */
  isLoading: boolean;
  /** Whether the agent is currently speaking */
  isSpeaking: boolean;
}

/**
 * Displays a companion's static avatar image by default.
 * When a lip-sync video URL is provided, crossfades to the video.
 * Returns to the static image when the video ends.
 */
export function LipSyncPlayer({
  companionAvatarUrl,
  videoUrl,
  isLoading,
  isSpeaking,
}: LipSyncPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // When videoUrl changes, reset state
  useEffect(() => {
    setVideoReady(false);
    setIsVideoPlaying(false);
  }, [videoUrl]);

  const handleCanPlay = useCallback(() => {
    setVideoReady(true);
    // Auto-play when ready
    if (videoRef.current) {
      videoRef.current.play().then(() => {
        setIsVideoPlaying(true);
      }).catch((err) => {
        console.warn('[LipSyncPlayer] Video autoplay failed:', err);
      });
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsVideoPlaying(false);
    setVideoReady(false);
  }, []);

  const handleVideoError = useCallback(() => {
    console.warn('[LipSyncPlayer] Video playback error');
    setIsVideoPlaying(false);
    setVideoReady(false);
  }, []);

  const showVideo = videoUrl && videoReady && isVideoPlaying;

  return (
    <div className="relative w-full max-w-[280px] mx-auto aspect-[3/4] rounded-2xl overflow-hidden bg-muted">
      {/* Static avatar image (always rendered as base layer) */}
      <img
        src={companionAvatarUrl}
        alt="Companion avatar"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          showVideo ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Lip-sync video overlay */}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            showVideo ? 'opacity-100' : 'opacity-0'
          }`}
          playsInline
          muted
          onCanPlay={handleCanPlay}
          onEnded={handleVideoEnded}
          onError={handleVideoError}
        />
      )}

      {/* Loading spinner overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
          <div className="bg-black/50 rounded-full p-3">
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Speaking indicator ring */}
      {isSpeaking && !showVideo && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-emerald-500/60 ring-offset-0 animate-pulse pointer-events-none" />
      )}
    </div>
  );
}
