'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanionVideoFeed } from './companion-video-feed';
import { VideoCallControls } from './video-call-controls';
import { VideoCallOverlay } from './video-call-overlay';
import type { VideoCallStatus } from '@/hooks/use-video-call';
import type { RemoteTrack } from 'livekit-client';

interface VideoCallContainerProps {
  status: VideoCallStatus;
  companionName: string;
  avatarUrl?: string;
  remoteVideoTrack: RemoteTrack | null;
  remoteAudioTrack: RemoteTrack | null;
  duration: number;
  isMicMuted: boolean;
  isCameraEnabled: boolean;
  error: string | null;
  callSummary: { duration: number; tokensUsed: number } | null;
  tokenBalance?: number;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onEndCall: () => void;
  onClose: () => void;
}

/**
 * Full-screen video call container.
 * Shows companion's video feed, overlays, and controls.
 */
export function VideoCallContainer({
  status,
  companionName,
  avatarUrl,
  remoteVideoTrack,
  duration,
  isMicMuted,
  isCameraEnabled,
  error,
  callSummary,
  tokenBalance,
  onToggleMic,
  onToggleCamera,
  onEndCall,
  onClose,
}: VideoCallContainerProps) {
  const isEnded = status === 'ended';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 bg-black flex flex-col"
      >
        {/* Close button - always visible */}
        {isEnded && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-40 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20"
            onClick={onClose}
            aria-label="Close video call"
          >
            <X className="h-5 w-5" />
          </Button>
        )}

        {/* Video feed - takes up most of the screen */}
        <div className="relative flex-1 min-h-0">
          <CompanionVideoFeed
            videoTrack={remoteVideoTrack}
            companionName={companionName}
            avatarUrl={avatarUrl}
          />

          {/* Overlays */}
          <VideoCallOverlay
            status={status}
            companionName={companionName}
            avatarUrl={avatarUrl}
            error={error}
            duration={duration}
            callSummary={callSummary}
            tokenBalance={tokenBalance}
          />
        </div>

        {/* Controls bar - bottom */}
        {!isEnded && (
          <div className="relative bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <VideoCallControls
              status={status}
              isMicMuted={isMicMuted}
              isCameraEnabled={isCameraEnabled}
              onToggleMic={onToggleMic}
              onToggleCamera={onToggleCamera}
              onEndCall={onEndCall}
              tokenBalance={tokenBalance}
            />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
