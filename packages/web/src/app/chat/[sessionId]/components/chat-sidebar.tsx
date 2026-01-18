'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Sparkles, Gift, BookOpen, Gamepad2, Users, GripVertical, Heart } from 'lucide-react';
import { AnimatedFlame } from '@/components/ui/animated-flame';
import Link from 'next/link';
import { CompanionAvatar, CompanionAvatarSwitcher } from '@/components/companion';
import { CallButton, CallSidebar } from '@/components/voice-call';
import { VideoRequestButton } from '@/components/video';
import { LikeHeartsAnimation } from '@/components/likes/like-hearts-animation';
import type { Companion } from '@/lib/api';
import type { CompanionBackstory } from '@/lib/api';
import type { EmotionalState } from '@/lib/api/imagegen';
import type { SignupTrigger } from '@/components/demo/signup-modal';
import type { VoiceCallState } from '@/hooks/use-voice-call';

interface ChatSidebarProps {
  // Companion data
  companion: Companion | null;
  backstoryData: CompanionBackstory | null;
  currentEmotionalState: EmotionalState;
  customPrompt?: string;
  isGeneratingNewCompanion: boolean;
  onSwitchCompanion: () => Promise<void>;

  // Avatar
  currentAvatarUrl: string | null;
  avatarDimensions: { width: number; height: number; genWidth: number; genHeight: number };
  imageGenTrigger: number;
  sceneDescription?: string;
  onAvatarLoad: (imageUrl: string) => void;

  // Session
  sessionId: string;
  userId?: string;

  // Likes
  sessionTotalLikes: number;
  likeAnimationTrigger: number;

  // Voice call
  isCallActive: boolean;
  callState: VoiceCallState;
  isCallMuted: boolean;
  currentTranscript: string;
  analyserNode: AnalyserNode | null;
  onEndCall: () => void;
  onToggleMute: () => void;
  onCallClick: () => void;

  // Webcam
  isWebcamEnabled: boolean;
  isCapturing: boolean;
  latestFrame: string | null;

  // Modal toggles
  onShowGallery: () => void;
  onShowPersonality: () => void;
  onShowBackstory: () => void;
  onShowGames: () => void;
  onShowGifts: () => void;
  onShowFriends: () => void;
  onShowVideoRequest: () => void;

  // Demo mode
  isDemo?: boolean;
  onRequireAuth?: (trigger: SignupTrigger) => void;
  onSwitchDemoCompanion?: () => Promise<void>;
  isSwitchingDemoCompanion?: boolean;

  // Resize
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  isResizing: boolean;
  isNearGrabber: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  onMouseMoveNearGrabber: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeaveGrabber: () => void;

  // Navigation
  onDesignCompanion: () => void;
}

export function ChatSidebar({
  companion,
  backstoryData,
  currentEmotionalState,
  customPrompt,
  isGeneratingNewCompanion,
  onSwitchCompanion,
  currentAvatarUrl,
  avatarDimensions,
  imageGenTrigger,
  sceneDescription,
  onAvatarLoad,
  sessionId,
  userId,
  sessionTotalLikes,
  likeAnimationTrigger,
  isCallActive,
  callState,
  isCallMuted,
  currentTranscript,
  analyserNode,
  onEndCall,
  onToggleMute,
  onCallClick,
  isWebcamEnabled,
  isCapturing,
  latestFrame,
  onShowGallery,
  onShowPersonality,
  onShowBackstory,
  onShowGames,
  onShowGifts,
  onShowFriends,
  onShowVideoRequest,
  isDemo,
  onRequireAuth,
  onSwitchDemoCompanion,
  isSwitchingDemoCompanion,
  sidebarRef,
  sidebarWidth,
  isResizing,
  isNearGrabber,
  onResizeStart,
  onMouseMoveNearGrabber,
  onMouseLeaveGrabber,
  onDesignCompanion,
}: ChatSidebarProps) {
  const handleDemoGuard = (action: SignupTrigger, callback: () => void) => {
    if (isDemo && onRequireAuth) {
      onRequireAuth(action);
    } else {
      callback();
    }
  };

  return (
    <div
      ref={sidebarRef}
      className="hidden lg:flex flex-col items-center p-4 bg-muted/10 relative select-none overflow-y-auto overflow-x-hidden scrollbar-subtle"
      style={{ width: sidebarWidth }}
      onMouseMove={onMouseMoveNearGrabber}
      onMouseLeave={onMouseLeaveGrabber}
    >
      {/* Voice Call Sidebar - shown when call is active */}
      {isCallActive && companion ? (
        <CallSidebar
          companionName={companion.name}
          companionAvatarUrl={currentAvatarUrl || companion.avatarUrl}
          callState={callState}
          isMuted={isCallMuted}
          currentTranscript={currentTranscript}
          analyserNode={analyserNode}
          onEndCall={onEndCall}
          onToggleMute={onToggleMute}
        />
      ) : (
        <>
          {/* Campfire Logo */}
          <Link
            href="/"
            className="mb-4 self-start hover:opacity-80 transition-opacity"
          >
            <AnimatedFlame size="md" />
          </Link>

          {/* Only render CompanionAvatar once we have companion data with anchor image */}
          {companion?.avatarUrl ? (
            <CompanionAvatarSwitcher
              onSwitch={isDemo && onSwitchDemoCompanion ? onSwitchDemoCompanion : onSwitchCompanion}
              isGenerating={isGeneratingNewCompanion || Boolean(isDemo && isSwitchingDemoCompanion)}
              disabled={Boolean(isDemo && !onSwitchDemoCompanion)}
            >
              <button
                onClick={() => handleDemoGuard('gallery', onShowGallery)}
                className="relative cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-campfire-500 focus:ring-offset-2 focus:ring-offset-background rounded-xl overflow-hidden"
                style={{ width: avatarDimensions.width, height: avatarDimensions.height }}
                aria-label="View gallery"
              >
                <CompanionAvatar
                  emotionalState={currentEmotionalState}
                  customPrompt={customPrompt}
                  width={avatarDimensions.genWidth}
                  height={avatarDimensions.genHeight}
                  autoRegenerate={false}
                  debounceDelay={2000}
                  className="shadow-lg w-full h-full"
                  userId={userId}
                  sessionId={sessionId}
                  companionId={companion.id}
                  anchorImageUrl={companion.avatarUrl}
                  anchorRenditions={companion.avatarRenditions}
                  generationTrigger={imageGenTrigger}
                  sceneDescription={sceneDescription}
                  onLoad={onAvatarLoad}
                />
                <LikeHeartsAnimation trigger={likeAnimationTrigger} />
              </button>
            </CompanionAvatarSwitcher>
          ) : (
            /* Loading placeholder while companion data loads */
            <div
              className="rounded-xl bg-gradient-to-b from-primary/5 to-primary/10 shadow-lg animate-pulse"
              style={{ width: avatarDimensions.width, height: avatarDimensions.height }}
            />
          )}

          <div className="mt-3 h-6 flex items-center justify-center">
            {companion && !isGeneratingNewCompanion && !(isDemo && isSwitchingDemoCompanion) ? (
              <p className="text-base font-semibold text-foreground">{companion.name}</p>
            ) : (
              <div className="w-32 h-5 bg-muted animate-pulse rounded" />
            )}
          </div>

          <div className="flex items-center justify-center gap-1 mt-1 h-5">
            {!isGeneratingNewCompanion && !(isDemo && isSwitchingDemoCompanion) ? (
              <>
                <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                <span className="text-sm font-medium text-foreground">{sessionTotalLikes}</span>
              </>
            ) : (
              <div className="w-12 h-4 bg-muted animate-pulse rounded" />
            )}
          </div>

          <div className="mt-1 h-5 flex items-center justify-center">
            {!isGeneratingNewCompanion && !(isDemo && isSwitchingDemoCompanion) ? (
              <p className="text-sm text-muted-foreground">
                Feeling: <span className="font-medium text-foreground capitalize">{currentEmotionalState}</span>
              </p>
            ) : (
              <div className="w-24 h-4 bg-muted animate-pulse rounded" />
            )}
          </div>

          {/* Buttons section - fade out during companion switch */}
          <div className={`w-full transition-opacity duration-300 ${isGeneratingNewCompanion || (isDemo && isSwitchingDemoCompanion) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            {/* Call & Video Buttons - Side by side circles */}
            <div className="flex items-center justify-center gap-4 mt-3">
              <CallButton onClick={onCallClick} disabled={isCallActive} />
              <VideoRequestButton
                onClick={() => handleDemoGuard('video', onShowVideoRequest)}
                disabled={isCallActive}
              />
            </div>

            <div className="flex flex-col gap-2.5 mt-4 w-full px-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-3 px-5 py-4 text-base"
                onClick={() => handleDemoGuard('personality', onShowPersonality)}
              >
                <Sparkles className="h-5 w-5" />
                Personality
              </Button>

              {backstoryData?.hasBackstory && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 px-5 py-4 text-base border-amber-700/30 text-amber-500 hover:bg-amber-900/20 hover:text-amber-400"
                  onClick={() => handleDemoGuard('avatar', onShowBackstory)}
                >
                  <BookOpen className="h-5 w-5" />
                  Backstory
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full justify-start gap-3 px-5 py-4 text-base border-cyan-700/30 text-cyan-500 hover:bg-cyan-900/20 hover:text-cyan-400"
                onClick={() => handleDemoGuard('games', onShowGames)}
              >
                <Gamepad2 className="h-5 w-5" />
                Games
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-3 px-5 py-4 text-base border-rose-700/30 text-rose-500 hover:bg-rose-900/20 hover:text-rose-400"
                onClick={() => handleDemoGuard('gifts', onShowGifts)}
              >
                <Gift className="h-5 w-5" />
                Gifts
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-3 px-5 py-4 text-base border-purple-700/30 text-purple-500 hover:bg-purple-900/20 hover:text-purple-400"
                onClick={() => handleDemoGuard('friends', onShowFriends)}
              >
                <Users className="h-5 w-5" />
                Friends
              </Button>
            </div>
          </div>

          {/* Spacer to push webcam to bottom */}
          <div className="flex-1" />

          {/* Design Companion button at bottom */}
          <div className="w-full px-2 mb-4">
            <Button
              variant="default"
              className="w-full justify-center py-5 text-base bg-gradient-to-r from-campfire-500 via-rose-500 to-orange-500 hover:from-campfire-600 hover:via-rose-600 hover:to-orange-600 shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] transition-all duration-300"
              onClick={onDesignCompanion}
            >
              Design Companion
            </Button>
          </div>
        </>
      )}

      {/* Webcam preview at bottom of sidebar */}
      {isWebcamEnabled && latestFrame && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="relative">
            <img
              src={latestFrame}
              alt="Webcam preview"
              className="w-24 h-18 rounded-lg object-cover border-2 border-campfire-500/50 shadow-md"
            />
            {isCapturing && (
              <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-sm" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">Camera active</span>
        </div>
      )}

      {/* Resize Grabber */}
      <AnimatePresence>
        {(isNearGrabber || isResizing) && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute right-0 top-0 bottom-0 w-4 flex items-center justify-center cursor-col-resize z-10"
            onMouseDown={onResizeStart}
          >
            <motion.div
              className="h-16 w-1.5 rounded-full bg-muted-foreground/30 flex items-center justify-center"
              whileHover={{ scale: 1.2, backgroundColor: 'rgba(255,255,255,0.4)' }}
              whileTap={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.5)' }}
              animate={isResizing ? { scale: 1.1, backgroundColor: 'rgba(255,255,255,0.5)' } : {}}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
