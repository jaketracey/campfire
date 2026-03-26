'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, WifiOff, AlertTriangle, Clock, Coins } from 'lucide-react';
import type { VideoCallStatus } from '@/hooks/use-video-call';

interface VideoCallOverlayProps {
  status: VideoCallStatus;
  companionName: string;
  avatarUrl?: string;
  error: string | null;
  duration: number;
  callSummary: { duration: number; tokensUsed: number } | null;
  tokenBalance?: number;
  tokenWarningThreshold?: number;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Overlay elements for different video call states:
 * connecting animation, reconnection warning, token warnings, call summary.
 */
export function VideoCallOverlay({
  status,
  companionName,
  avatarUrl,
  error,
  duration,
  callSummary,
  tokenBalance,
  tokenWarningThreshold = 100,
}: VideoCallOverlayProps) {
  const showTokenWarning =
    status === 'active' &&
    typeof tokenBalance === 'number' &&
    tokenBalance > 0 &&
    tokenBalance < tokenWarningThreshold;

  return (
    <>
      {/* Connecting state */}
      <AnimatePresence>
        {status === 'connecting' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            {avatarUrl ? (
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="w-28 h-28 rounded-full overflow-hidden border-2 border-white/20 mb-6"
              >
                <img src={avatarUrl} alt={companionName} className="w-full h-full object-cover" />
              </motion.div>
            ) : (
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="w-28 h-28 rounded-full bg-zinc-800 border-2 border-white/20 mb-6 flex items-center justify-center"
              >
                <span className="text-3xl text-zinc-400">
                  {companionName.charAt(0).toUpperCase()}
                </span>
              </motion.div>
            )}
            <div className="flex items-center gap-2 text-white">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Connecting to {companionName}...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reconnecting warning */}
      <AnimatePresence>
        {status === 'reconnecting' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-amber-900/80 backdrop-blur-sm border border-amber-700/50 text-amber-200 rounded-full px-4 py-2 text-sm"
          >
            <WifiOff className="h-4 w-4" />
            <span>Poor connection - reconnecting...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Token low warning */}
      <AnimatePresence>
        {showTokenWarning && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-red-900/80 backdrop-blur-sm border border-red-700/50 text-red-200 rounded-full px-4 py-2 text-sm"
          >
            <AlertTriangle className="h-4 w-4" />
            <span>Low tokens: {tokenBalance}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error overlay */}
      <AnimatePresence>
        {error && status !== 'connecting' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-red-900/80 backdrop-blur-sm border border-red-700/50 text-red-200 rounded-lg px-4 py-2 text-sm max-w-sm"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active call duration - top left */}
      <AnimatePresence>
        {(status === 'active' || status === 'reconnecting') && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5"
          >
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-sm font-mono">{formatDuration(duration)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Companion name overlay */}
      <AnimatePresence>
        {(status === 'active' || status === 'reconnecting') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-black/40 backdrop-blur-sm rounded-full px-4 py-1.5"
          >
            <span className="text-white text-sm font-medium">{companionName}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Call ended summary */}
      <AnimatePresence>
        {status === 'ended' && callSummary && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md"
          >
            <h3 className="text-white text-lg font-semibold mb-6">Call Ended</h3>
            <div className="flex gap-8 mb-6">
              <div className="flex flex-col items-center gap-1">
                <Clock className="h-5 w-5 text-zinc-400" />
                <span className="text-white text-lg font-mono">
                  {formatDuration(callSummary.duration)}
                </span>
                <span className="text-zinc-500 text-xs">Duration</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Coins className="h-5 w-5 text-zinc-400" />
                <span className="text-white text-lg">{callSummary.tokensUsed}</span>
                <span className="text-zinc-500 text-xs">Tokens used</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
