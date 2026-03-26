'use client';

import { motion } from 'framer-motion';
import { Mic, MicOff, Camera, CameraOff, PhoneOff, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { VideoCallStatus } from '@/hooks/use-video-call';

interface VideoCallControlsProps {
  status: VideoCallStatus;
  isMicMuted: boolean;
  isCameraEnabled: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onEndCall: () => void;
  tokenBalance?: number;
}

/**
 * Control bar for video calls with mic, camera, end call, and settings.
 * Semi-transparent, overlaid at the bottom of the video feed.
 */
export function VideoCallControls({
  status,
  isMicMuted,
  isCameraEnabled,
  onToggleMic,
  onToggleCamera,
  onEndCall,
  tokenBalance,
}: VideoCallControlsProps) {
  const isActive = status === 'active' || status === 'reconnecting';

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-center justify-center gap-3 p-4"
    >
      {/* Token balance */}
      {typeof tokenBalance === 'number' && (
        <div className="absolute left-4 bottom-4 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 text-xs text-zinc-300">
          {tokenBalance.toLocaleString()} tokens
        </div>
      )}

      {/* Mic toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={`rounded-full w-12 h-12 backdrop-blur-sm transition-colors ${
          isMicMuted
            ? 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
            : 'bg-white/10 border border-white/20 text-white hover:bg-white/20'
        }`}
        onClick={onToggleMic}
        disabled={!isActive}
        aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
      >
        {isMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
      </Button>

      {/* Camera toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={`rounded-full w-12 h-12 backdrop-blur-sm transition-colors ${
          isCameraEnabled
            ? 'bg-white/10 border border-white/20 text-white hover:bg-white/20'
            : 'bg-white/10 border border-white/20 text-zinc-400 hover:bg-white/20'
        }`}
        onClick={onToggleCamera}
        disabled={!isActive}
        aria-label={isCameraEnabled ? 'Disable camera' : 'Enable camera'}
      >
        {isCameraEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
      </Button>

      {/* End call - large red button */}
      <Button
        variant="destructive"
        size="icon"
        className="rounded-full w-14 h-14 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30"
        onClick={onEndCall}
        aria-label="End video call"
      >
        <PhoneOff className="h-6 w-6" />
      </Button>

      {/* Settings */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-12 h-12 bg-white/10 border border-white/20 text-white hover:bg-white/20 backdrop-blur-sm"
            disabled={!isActive}
            aria-label="Call settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="mb-2">
          <DropdownMenuItem disabled>Auto (recommended)</DropdownMenuItem>
          <DropdownMenuItem disabled>720p</DropdownMenuItem>
          <DropdownMenuItem disabled>480p</DropdownMenuItem>
          <DropdownMenuItem disabled>360p</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  );
}
