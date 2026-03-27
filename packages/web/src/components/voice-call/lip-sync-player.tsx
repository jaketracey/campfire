'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface LipSyncPlayerProps {
  /** Static companion avatar image URL (shown when no video) */
  companionAvatarUrl: string;
  /** Lip-synced video URL (when available, plays on top of avatar) */
  videoUrl: string | null;
  /** Whether a lip-sync video is currently being generated */
  isLoading: boolean;
  /** Whether the agent is currently speaking */
  isSpeaking: boolean;
  /** Called when video is ready to play (for audio sync) */
  onVideoReady?: () => void;
}

/**
 * Displays a companion's static avatar image by default.
 * When a lip-sync video URL is provided, crossfades to the video.
 * Loops the last video clip while waiting for the next one.
 */
export function LipSyncPlayer({
  companionAvatarUrl,
  videoUrl,
  isLoading,
  isSpeaking,
  onVideoReady,
}: LipSyncPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  // When a NEW videoUrl arrives, switch to it
  useEffect(() => {
    if (videoUrl && videoUrl !== activeVideoUrl) {
      setVideoReady(false);
      setIsVideoPlaying(false);
      setActiveVideoUrl(videoUrl);
    }
  }, [videoUrl, activeVideoUrl]);

  const handleCanPlay = useCallback(() => {
    setVideoReady(true);
    if (videoRef.current) {
      videoRef.current.play().then(() => {
        setIsVideoPlaying(true);
        onVideoReady?.();
      }).catch((err) => {
        console.warn('[LipSyncPlayer] Video autoplay failed:', err);
      });
    }
  }, [onVideoReady]);

  const handleVideoEnded = useCallback(() => {
    // Loop the video — keep replaying the last clip
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const handleVideoError = useCallback(() => {
    console.warn('[LipSyncPlayer] Video playback error');
    setIsVideoPlaying(false);
    setVideoReady(false);
  }, []);

  const showVideo = activeVideoUrl && videoReady && isVideoPlaying;

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
      {activeVideoUrl && (
        <video
          ref={videoRef}
          src={activeVideoUrl}
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

      {/* Subtle loading indicator — animated border glow that doesn't obscure the video */}
      {isLoading && (
        <div className="absolute inset-0 rounded-2xl pointer-events-none">
          <div className="absolute inset-0 rounded-2xl animate-pulse ring-2 ring-violet-500/40 ring-offset-0" />
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
              <div className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      {/* Speaking indicator — subtle glow when speaking without video */}
      {isSpeaking && !showVideo && !isLoading && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-emerald-500/40 ring-offset-0 animate-pulse pointer-events-none" />
      )}
    </div>
  );
}
