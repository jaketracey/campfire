'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Gift, BookOpen, Gamepad2, Users, GripVertical, Heart, Menu as MenuIcon, X as CloseIcon } from 'lucide-react';
import { AnimatedFlame } from '@/components/ui/animated-flame';
import Link from 'next/link';
import { CompanionAvatar, CompanionAvatarSwitcher } from '@/components/companion';
import { CallButton, CallSidebar } from '@/components/voice-call';
import { VideoCallButton } from '@/components/video-call';
import { VideoRequestButton } from '@/components/video';
import { LikeHeartsAnimation } from '@/components/likes/like-hearts-animation';
import type { Companion } from '@/lib/api';
import type { CompanionBackstory } from '@/lib/api';
import type { EmotionalState } from '@/lib/api/imagegen';
import type { SignupTrigger } from '@/components/demo/signup-modal';
import type { VoiceChatState } from '@/hooks/use-voice-chat';

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
  imageTurnId?: string;
  onAvatarLoad: (imageUrl: string, cacheKey?: string, turnId?: string) => void;

  // Session
  sessionId: string;
  userId?: string;

  // Likes
  sessionTotalLikes: number;
  likeAnimationTrigger: number;

  // Voice call
  isCallActive: boolean;
  voiceState: VoiceChatState;
  isCallMuted: boolean;
  agentMessage: string;
  userTranscript: string;
  onEndCall: () => void;
  onToggleMute: () => void;
  onCallClick: () => void;
  getInputFrequencyData?: () => Uint8Array | undefined;
  getOutputFrequencyData?: () => Uint8Array | undefined;

  // Lip-sync video
  currentVideoUrl?: string | null;
  isVideoLoading?: boolean;
  videoEnabled?: boolean;
  onToggleVideo?: () => void;

  // Webcam
  isWebcamEnabled: boolean;
  isCapturing: boolean;
  latestFrame: string | null;

  // Video call
  onVideoCallClick: () => void;
  isVideoCallActive: boolean;

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
  imageTurnId,
  onAvatarLoad,
  sessionId,
  userId,
  sessionTotalLikes,
  likeAnimationTrigger,
  isCallActive,
  voiceState,
  isCallMuted,
  agentMessage,
  userTranscript,
  onEndCall,
  onToggleMute,
  onCallClick,
  getInputFrequencyData,
  getOutputFrequencyData,
  currentVideoUrl,
  isVideoLoading,
  videoEnabled,
  onToggleVideo,
  isWebcamEnabled,
  isCapturing,
  latestFrame,
  onVideoCallClick,
  isVideoCallActive,
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
  const companionAvatarUrl = companion?.avatarUrl ?? null;
  const hasAlternateAvatar = Boolean(companionAvatarUrl && currentAvatarUrl && companionAvatarUrl !== currentAvatarUrl);
  const [showGeneratedAvatar, setShowGeneratedAvatar] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click / Escape
  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuButtonRef.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      setIsMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isMenuOpen]);
  const displayAvatarUrl = hasAlternateAvatar && !showGeneratedAvatar ? companionAvatarUrl : currentAvatarUrl || companionAvatarUrl;
  const thumbnailImageUrl = showGeneratedAvatar ? companionAvatarUrl : currentAvatarUrl || null;

  useEffect(() => {
    setShowGeneratedAvatar(Boolean(currentAvatarUrl));
  }, [currentAvatarUrl]);

  const handleAvatarToggle = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    if (!hasAlternateAvatar) return;
    event.preventDefault();
    event.stopPropagation();
    setShowGeneratedAvatar((prev) => !prev);
  };

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
          voiceState={voiceState}
          isMuted={isCallMuted}
          agentMessage={agentMessage}
          userTranscript={userTranscript}
          onEndCall={onEndCall}
          onToggleMute={onToggleMute}
          getInputFrequencyData={getInputFrequencyData}
          getOutputFrequencyData={getOutputFrequencyData}
          currentVideoUrl={currentVideoUrl}
          isVideoLoading={isVideoLoading}
          videoEnabled={videoEnabled}
          onToggleVideo={onToggleVideo}
        />
      ) : (
        <>
          {/* Campfire Logo */}
          <Link
            href="/"
            className="mb-4 self-start hover:opacity-80 transition-opacity"
            aria-label="Campfire home"
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
              <div
                onClick={() => handleDemoGuard('gallery', onShowGallery)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleDemoGuard('gallery', onShowGallery);
                  }
                }}
                className="relative cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-campfire-500 focus:ring-offset-2 focus:ring-offset-background rounded-xl overflow-hidden"
                role="button"
                tabIndex={0}
                style={{ width: avatarDimensions.width, height: avatarDimensions.height }}
                aria-label="View gallery"
              >
                <CompanionAvatar
                  key={displayAvatarUrl || companionAvatarUrl}
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
                  anchorImageUrl={displayAvatarUrl || companionAvatarUrl || undefined}
                  anchorRenditions={companion.avatarRenditions}
                  generationTrigger={showGeneratedAvatar ? imageGenTrigger : 0}
                  sceneDescription={sceneDescription}
                  turnId={imageTurnId}
                  onLoad={onAvatarLoad}
                />
                {hasAlternateAvatar && (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={showGeneratedAvatar ? 'Show profile image' : 'Show generated image'}
                    onClick={handleAvatarToggle}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        handleAvatarToggle(event);
                      }
                    }}
                    className="absolute right-2 bottom-2 h-14 w-14 rounded-lg overflow-hidden border-2 border-white/80 shadow-md bg-black/30 backdrop-blur-sm ring-1 ring-black/40 cursor-pointer"
                  >
                    <img
                      src={thumbnailImageUrl || companionAvatarUrl || ''}
                      alt="Companion avatar thumbnail"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-white/90">
                        {showGeneratedAvatar ? 'Profile' : 'Generated'}
                      </span>
                    </div>
                  </div>
                )}
                <LikeHeartsAnimation trigger={likeAnimationTrigger} />
              </div>
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

          {/* Call / Video circle buttons - fade out during companion switch */}
          <div className={`w-full transition-opacity duration-300 ${isGeneratingNewCompanion || (isDemo && isSwitchingDemoCompanion) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <div className="flex items-center justify-center gap-4 mt-3">
              <CallButton onClick={onCallClick} disabled={isCallActive || isVideoCallActive} />
              {/* VideoCallButton hidden - LiveKit video agent not ready yet */}
              <VideoRequestButton
                onClick={() => handleDemoGuard('video', onShowVideoRequest)}
                disabled={isCallActive || isVideoCallActive}
              />
            </div>
          </div>

          {/* Spacer to push menu + design companion to bottom */}
          <div className="flex-1" />

          {/* Bottom action stack: Menu flyout + Design Companion */}
          <div
            className={`w-full px-2 mb-4 transition-opacity duration-300 ${isGeneratingNewCompanion || (isDemo && isSwitchingDemoCompanion) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          >
            <CompanionMenu
              isOpen={isMenuOpen}
              onToggle={() => setIsMenuOpen((prev) => !prev)}
              onClose={() => setIsMenuOpen(false)}
              menuButtonRef={menuButtonRef}
              flyoutRef={flyoutRef}
              items={[
                {
                  key: 'personality',
                  label: 'Personality',
                  icon: <Sparkles className="h-5 w-5" />,
                  accent: null,
                  onClick: () => handleDemoGuard('personality', onShowPersonality),
                  show: true,
                },
                {
                  key: 'backstory',
                  label: 'Backstory',
                  icon: <BookOpen className="h-5 w-5" />,
                  accent: 'amber',
                  onClick: () => handleDemoGuard('avatar', onShowBackstory),
                  show: Boolean(backstoryData?.hasBackstory),
                },
                {
                  key: 'games',
                  label: 'Games',
                  icon: <Gamepad2 className="h-5 w-5" />,
                  accent: 'cyan',
                  onClick: () => handleDemoGuard('games', onShowGames),
                  show: true,
                },
                {
                  key: 'gifts',
                  label: 'Gifts',
                  icon: <Gift className="h-5 w-5" />,
                  accent: 'rose',
                  onClick: () => handleDemoGuard('gifts', onShowGifts),
                  show: true,
                },
                {
                  key: 'friends',
                  label: 'Friends',
                  icon: <Users className="h-5 w-5" />,
                  accent: 'purple',
                  onClick: () => handleDemoGuard('friends', onShowFriends),
                  show: true,
                },
              ]}
            />

            <Button
              variant="default"
              className="w-full justify-center py-5 mt-2.5 text-base bg-gradient-to-r from-campfire-500 via-rose-500 to-orange-500 hover:from-campfire-600 hover:via-rose-600 hover:to-orange-600 shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] transition-all duration-300"
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

// ============================================================================
// CompanionMenu — collapsible flyout for companion actions
// ============================================================================

type MenuAccent = 'amber' | 'cyan' | 'rose' | 'purple' | null;

interface CompanionMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  accent: MenuAccent;
  onClick: () => void;
  show: boolean;
}

interface CompanionMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  items: CompanionMenuItem[];
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  flyoutRef: React.RefObject<HTMLDivElement | null>;
}

const ACCENT_CLASSES: Record<Exclude<MenuAccent, null>, { border: string; text: string; hover: string; glow: string }> = {
  amber: {
    border: 'border-amber-700/30',
    text: 'text-amber-500',
    hover: 'hover:bg-amber-900/20 hover:text-amber-400',
    glow: 'shadow-[0_0_20px_-8px_rgba(245,158,11,0.45)]',
  },
  cyan: {
    border: 'border-cyan-700/30',
    text: 'text-cyan-500',
    hover: 'hover:bg-cyan-900/20 hover:text-cyan-400',
    glow: 'shadow-[0_0_20px_-8px_rgba(6,182,212,0.45)]',
  },
  rose: {
    border: 'border-rose-700/30',
    text: 'text-rose-500',
    hover: 'hover:bg-rose-900/20 hover:text-rose-400',
    glow: 'shadow-[0_0_20px_-8px_rgba(244,63,94,0.45)]',
  },
  purple: {
    border: 'border-purple-700/30',
    text: 'text-purple-500',
    hover: 'hover:bg-purple-900/20 hover:text-purple-400',
    glow: 'shadow-[0_0_20px_-8px_rgba(168,85,247,0.45)]',
  },
};

function CompanionMenu({
  isOpen,
  onToggle,
  onClose,
  items,
  menuButtonRef,
  flyoutRef,
}: CompanionMenuProps) {
  const visibleItems = items.filter((item) => item.show);

  return (
    <div className="relative">
      {/* Flyout — positioned above the menu button, items stack upward (column-reverse) */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={flyoutRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute left-0 right-0 bottom-full mb-2 flex flex-col-reverse gap-2.5 z-20"
          >
            {visibleItems.map((item, index) => {
              const accent = item.accent ? ACCENT_CLASSES[item.accent] : null;
              return (
                <motion.div
                  key={item.key}
                  initial={{ opacity: 0, y: 18, scale: 0.94, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: 14, scale: 0.96, filter: 'blur(3px)' }}
                  transition={{
                    type: 'spring',
                    stiffness: 380,
                    damping: 28,
                    mass: 0.6,
                    delay: isOpen ? index * 0.035 : 0,
                  }}
                >
                  <Button
                    variant="outline"
                    className={`w-full justify-start gap-3 px-5 py-4 text-base backdrop-blur-sm bg-background/85 transition-shadow duration-300 ${
                      accent
                        ? `${accent.border} ${accent.text} ${accent.hover} ${accent.glow}`
                        : 'shadow-[0_0_20px_-8px_rgba(255,255,255,0.25)]'
                    }`}
                    onClick={() => {
                      onClose();
                      item.onClick();
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </Button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Menu button itself — pinned to bottom of the stack */}
      <motion.button
        ref={menuButtonRef}
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        whileTap={{ scale: 0.97 }}
        className={`relative w-full flex items-center justify-center gap-3 px-5 py-4 rounded-xl border text-base font-medium
          transition-all duration-300 overflow-hidden
          ${isOpen
            ? 'border-white/20 bg-background text-foreground shadow-[0_0_30px_-10px_rgba(255,255,255,0.35)]'
            : 'border-white/10 bg-background/70 text-foreground/90 hover:text-foreground hover:bg-background/90 hover:border-white/20'}
        `}
      >
        {/* Soft multi-color aura — hints at the colorful items inside */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(90deg,rgba(245,158,11,0.22),rgba(6,182,212,0.22),rgba(244,63,94,0.22),rgba(168,85,247,0.22))] transition-opacity duration-500 ${
            isOpen ? 'opacity-0' : 'opacity-[0.18]'
          }`}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-4 -bottom-px h-px bg-[linear-gradient(to_right,rgba(245,158,11,0.6),rgba(6,182,212,0.6),rgba(244,63,94,0.6),rgba(168,85,247,0.6))] transition-opacity duration-500 ${
            isOpen ? 'opacity-0' : 'opacity-70'
          }`}
        />
        <span className="relative flex items-center gap-3">
          <AnimatePresence mode="wait" initial={false}>
            {isOpen ? (
              <motion.span
                key="close"
                initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="inline-flex"
              >
                <CloseIcon className="h-5 w-5" />
              </motion.span>
            ) : (
              <motion.span
                key="menu"
                initial={{ opacity: 0, rotate: 45, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: -45, scale: 0.7 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="inline-flex"
              >
                <MenuIcon className="h-5 w-5" />
              </motion.span>
            )}
          </AnimatePresence>
          <span>{isOpen ? 'Close' : 'Menu'}</span>
        </span>
      </motion.button>
    </div>
  );
}
