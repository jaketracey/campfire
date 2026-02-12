'use client';

import { AnimatePresence } from 'framer-motion';
import { DebugPanel } from '@/components/debug-panel';
import { CompanionGallery, PersonalityModal, BackstoryModal } from '@/components/companion';
import { GiftsPanel } from '@/components/gifts';
import { FriendsPanel } from '@/components/friends';
import { GamesModal } from '@/components/games';
import { VideoRequestModal } from '@/components/video';
import { InsufficientTokensModal } from '@/components/voice-call';
import { SupportModal } from '@/components/support/support-modal';

import { useChatSession } from './hooks/use-chat-session';
import {
  ChatSidebar,
  ChatHeader,
  ChatMessages,
  ChatInput,
  MobileAvatar,
  MobileActionBar,
} from './components';
import type { ChatSessionContentProps } from './types';
import { useOnboardingStore } from '@/stores/onboarding-store';

export function ChatSessionContent({
  sessionId,
  isDemo,
  demoFingerprint,
  demoCompanion,
  onLimitReached,
  onRequireAuth,
  onSwitchDemoCompanion,
  isSwitchingDemoCompanion,
  demoAvatarTopRight,
}: ChatSessionContentProps) {
  const chat = useChatSession({
    sessionId,
    isDemo,
    demoFingerprint,
    demoCompanion,
    onLimitReached,
    onRequireAuth,
  });
  const resetOnboarding = useOnboardingStore((state) => state.reset);

  const handleDesignNewCompanion = () => {
    resetOnboarding();
    chat.router.push('/onboard');
  };

  // Show loading while checking auth
  if (chat.authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!chat.isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-dvh bg-background overflow-x-hidden">
      {/* Companion Avatar Sidebar */}
      <ChatSidebar
        companion={chat.companion}
        backstoryData={chat.backstoryData}
        currentEmotionalState={chat.currentEmotionalState}
        customPrompt={chat.customPrompt}
        isGeneratingNewCompanion={chat.isGeneratingNewCompanion}
        onSwitchCompanion={chat.handleSwitchCompanion}
        currentAvatarUrl={chat.currentAvatarUrl}
        avatarDimensions={chat.avatarDimensions}
        imageGenTrigger={chat.imageGenTrigger}
        sceneDescription={chat.sceneDescription}
        imageTurnId={chat.imageTurnId}
        onAvatarLoad={chat.handleAvatarLoad}
        sessionId={sessionId}
        userId={chat.user?.id}
        sessionTotalLikes={chat.sessionTotalLikes}
        likeAnimationTrigger={chat.likeAnimationTrigger}
        isCallActive={chat.isCallActive}
        callState={chat.callState}
        isCallMuted={chat.isCallMuted}
        currentTranscript={chat.currentTranscript}
        analyserNode={chat.getCallAnalyserNode()}
        onEndCall={chat.endCall}
        onToggleMute={chat.toggleCallMute}
        onCallClick={chat.handleCallClick}
        isWebcamEnabled={chat.isWebcamEnabled}
        isCapturing={chat.isCapturing}
        latestFrame={chat.latestFrame}
        onShowGallery={() => chat.setShowGallery(true)}
        onShowPersonality={() => chat.setShowPersonality(true)}
        onShowBackstory={() => chat.setShowBackstory(true)}
        onShowGames={() => chat.setShowGames(true)}
        onShowGifts={() => chat.setShowGiftsPanel(true)}
        onShowFriends={() => chat.setShowFriendsPanel(true)}
        onShowVideoRequest={() => chat.setShowVideoRequest(true)}
        isDemo={isDemo}
        onRequireAuth={onRequireAuth}
        onSwitchDemoCompanion={onSwitchDemoCompanion}
        isSwitchingDemoCompanion={isSwitchingDemoCompanion}
        sidebarRef={chat.sidebarRef}
        sidebarWidth={chat.sidebarWidth}
        isResizing={chat.isResizing}
        isNearGrabber={chat.isNearGrabber}
        onResizeStart={chat.handleResizeStart}
        onMouseMoveNearGrabber={chat.handleMouseMoveNearGrabber}
        onMouseLeaveGrabber={chat.handleMouseLeaveGrabber}
        onDesignCompanion={handleDesignNewCompanion}
      />

      {/* Main Chat Area */}
      <div
        className="flex flex-col flex-1 min-w-0 overflow-x-hidden"
        style={chat.keyboardHeight > 0 ? { paddingBottom: `${chat.inputHeight}px` } : undefined}
      >
        {/* Header */}
        <ChatHeader
          userRole={chat.user?.role}
          showGiftsPanel={chat.showGiftsPanel}
          showDebugPanel={chat.showDebugPanel}
          onToggleGiftsPanel={() => chat.setShowGiftsPanel(!chat.showGiftsPanel)}
          onToggleDebugPanel={() => chat.setShowDebugPanel(!chat.showDebugPanel)}
          onShowGallery={() => chat.setShowGallery(true)}
          onShowSupportModal={() => chat.setShowSupportModal(true)}
          showMobileMenu={chat.showMobileMenu}
          onToggleMobileMenu={() => chat.setShowMobileMenu(!chat.showMobileMenu)}
          onMobileNewChat={() => {
            chat.setShowMobileMenu(false);
            handleDesignNewCompanion();
          }}
          onMobileGallery={() => {
            chat.setShowMobileMenu(false);
            chat.setShowGallery(true);
          }}
          onMobileGifts={() => {
            chat.setShowMobileMenu(false);
            chat.setShowGiftsPanel(!chat.showGiftsPanel);
          }}
          onMobileDebug={() => {
            chat.setShowMobileMenu(false);
            chat.setShowDebugPanel(!chat.showDebugPanel);
          }}
          onMobileAccount={() => {
            chat.setShowMobileMenu(false);
            chat.router.push('/account');
          }}
          onMobileClose={() => {
            chat.setShowMobileMenu(false);
            chat.router.push('/dashboard');
          }}
          onMobileSupport={() => {
            chat.setShowMobileMenu(false);
            chat.setShowSupportModal(true);
          }}
          isDemo={isDemo}
          onRequireAuth={onRequireAuth}
        />

        {/* Spacer for fixed header on mobile */}
        <div className="h-14 lg:hidden" />

        {/* Messages */}
        <ChatMessages
          messages={chat.messages}
          streamingContent={chat.streamingContent}
          isLoading={chat.isLoading}
          showTypingBetweenMessages={chat.showTypingBetweenMessages}
          messagesEndRef={chat.messagesEndRef}
          keyboardHeight={chat.keyboardHeight}
          messageLikes={chat.messageLikes}
          onLikeMessage={chat.handleLikeMessage}
          scrollToBottom={chat.scrollToBottom}
          activeGame={chat.activeGame}
          waitingForCompanionMove={chat.waitingForCompanionMove}
          companionName={chat.companion?.name || 'Companion'}
          onUserMove={chat.handleUserMove}
          onResign={chat.handleResign}
          isDemo={isDemo}
          mobileAvatarUrl={chat.currentAvatarUrl}
          onMobileAvatarClick={() => chat.setShowMobileAvatar(true)}
        />

        {/* Input Area with Mobile Action Bar - Fixed on mobile/tablet, static on desktop */}
        <div ref={chat.inputContainerRef} className="py-4 px-6 lg:px-4 bg-background z-40 fixed bottom-0 left-0 right-0 lg:relative lg:bottom-auto lg:left-auto lg:right-auto">
          {/* Mobile Action Bar */}
          <MobileActionBar
            backstoryData={chat.backstoryData}
            isCallActive={chat.isCallActive}
            onCallClick={chat.handleCallClick}
            onShowPersonality={() => chat.setShowPersonality(true)}
            onShowBackstory={() => chat.setShowBackstory(true)}
            onShowGames={() => chat.setShowGames(true)}
            onShowGifts={() => chat.setShowGiftsPanel(true)}
            onShowFriends={() => chat.setShowFriendsPanel(true)}
            isDemo={isDemo}
            onRequireAuth={onRequireAuth}
          />

          {/* Chat Input */}
          <ChatInput
            input={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.handleSend}
            isLoading={chat.isLoading}
            isRecording={chat.isRecording}
            voiceModeEnabled={chat.voiceModeEnabled}
            hasShownPulse={chat.hasShownPulse}
            messageReceivedPulseTrigger={chat.messageReceivedPulseTrigger}
            liveTranscription={chat.liveTranscription}
            voiceError={chat.voiceError}
            webcamError={chat.webcamError}
            isTTSPlaying={chat.isTTSPlaying}
            onSwitchCompanion={chat.handleSwitchCompanion}
            isSwitchingCompanion={chat.isGeneratingNewCompanion}
            isDemo={isDemo}
            inputRef={chat.inputRef}
            inputContainerRef={chat.inputContainerRef}
          />
        </div>

        {/* Mobile Avatar Gallery (expanded view) */}
        <AnimatePresence>
          {chat.showMobileAvatar && (
            <MobileAvatar
              currentAvatarUrl={chat.currentAvatarUrl}
              companionName={chat.companion?.name || 'Companion'}
              showMobileAvatar={chat.showMobileAvatar}
              onToggleMobileAvatar={() => chat.setShowMobileAvatar(false)}
              keyboardHeight={chat.keyboardHeight}
              mobileAvatarPop={chat.mobileAvatarPop}
              likeAnimationTrigger={chat.likeAnimationTrigger}
              mobileGalleryImages={chat.mobileGalleryImages}
              mobileGalleryIndex={chat.mobileGalleryIndex}
              onGalleryIndexChange={chat.setMobileGalleryIndex}
              mobileGalleryLoading={chat.mobileGalleryLoading}
              isDemo={isDemo}
              onRequireAuth={onRequireAuth}
              demoAvatarTopRight={demoAvatarTopRight}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Debug Panel */}
      <DebugPanel
        sessionId={sessionId}
        isOpen={chat.showDebugPanel}
        onClose={() => chat.setShowDebugPanel(false)}
        refreshTrigger={chat.debugRefreshTrigger}
      />

      {/* Companion Gallery */}
      <CompanionGallery
        sessionId={sessionId}
        isOpen={chat.showGallery}
        onClose={() => chat.setShowGallery(false)}
      />

      {/* Personality Modal */}
      <PersonalityModal
        companion={chat.companion}
        isOpen={chat.showPersonality}
        onClose={() => chat.setShowPersonality(false)}
        onSave={chat.handlePersonalitySave}
      />

      {/* Backstory Modal */}
      <BackstoryModal
        isOpen={chat.showBackstory}
        onClose={() => chat.setShowBackstory(false)}
        companionName={chat.companion?.name || ''}
        backstory={chat.backstoryData?.backstory || ''}
        archetype={chat.companion?.spec?.personality?.archetype}
        avatarUrl={chat.companion?.avatarUrl || undefined}
      />

      {/* Video Request Modal */}
      <VideoRequestModal
        isOpen={chat.showVideoRequest}
        onClose={() => chat.setShowVideoRequest(false)}
        companionId={chat.companion?.id || ''}
        companionName={chat.companion?.name || ''}
        sessionId={sessionId}
        avatarUrl={chat.companion?.avatarUrl || undefined}
        tokenBalance={chat.tokenBalance}
        onSuccess={chat.handleVideoRequestSuccess}
      />

      {/* Games Modal */}
      <GamesModal
        isOpen={chat.showGames}
        onClose={() => chat.setShowGames(false)}
        onSelectGame={chat.handleStartGame}
        companionName={chat.companion?.name}
      />

      {/* Gifts Panel */}
      {chat.companion && (
        <GiftsPanel
          sessionId={sessionId}
          companionId={chat.companion.id}
          isOpen={chat.showGiftsPanel}
          onClose={() => chat.setShowGiftsPanel(false)}
          onGiftSent={chat.handleGiftSent}
        />
      )}

      {/* Friends Panel */}
      {chat.companion && (
        <FriendsPanel
          companionId={chat.companion.id}
          companionName={chat.companion.name}
          isOpen={chat.showFriendsPanel}
          onClose={() => chat.setShowFriendsPanel(false)}
          activeParticipantIds={chat.groupParticipants.map(p => p.companionId)}
          isGroupChat={chat.isGroupChat}
          onInviteFriend={chat.handleInviteFriend}
        />
      )}

      {/* Insufficient Tokens Modal (Voice Call) */}
      <InsufficientTokensModal
        isOpen={chat.insufficientTokens}
        onClose={chat.clearInsufficientTokens}
        currentBalance={chat.voiceCallBalance ?? 0}
      />

      {/* Support Modal */}
      <SupportModal
        open={chat.showSupportModal}
        onOpenChange={chat.setShowSupportModal}
      />
    </div>
  );
}
