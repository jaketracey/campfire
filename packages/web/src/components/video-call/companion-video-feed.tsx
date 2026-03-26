'use client';

import { useEffect, useRef, useState } from 'react';
import { RemoteTrack } from 'livekit-client';
import { motion, AnimatePresence } from 'framer-motion';

interface CompanionVideoFeedProps {
  videoTrack: RemoteTrack | null;
  companionName: string;
  avatarUrl?: string;
  className?: string;
}

/**
 * Renders the LiveKit remote video track for the companion.
 * Falls back to a static avatar image if video is unavailable.
 */
export function CompanionVideoFeed({
  videoTrack,
  companionName,
  avatarUrl,
  className = '',
}: CompanionVideoFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    if (!videoTrack || !videoRef.current) {
      setIsVideoReady(false);
      return;
    }

    const videoEl = videoRef.current;
    videoTrack.attach(videoEl);
    setIsVideoReady(true);

    return () => {
      videoTrack.detach(videoEl);
      setIsVideoReady(false);
    };
  }, [videoTrack]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-black ${className}`}>
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transition-opacity duration-700 ${
          isVideoReady ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Avatar fallback when video is not available */}
      <AnimatePresence>
        {!isVideoReady && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-zinc-900 to-black"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={companionName}
                className="w-full h-full object-cover opacity-60"
              />
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="w-32 h-32 rounded-full bg-zinc-800 flex items-center justify-center">
                  <span className="text-4xl text-zinc-500">
                    {companionName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="text-zinc-400 text-sm">{companionName}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
