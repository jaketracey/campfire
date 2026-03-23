'use client';

import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceOrb } from './voice-orb';
import type { VoiceChatState } from '@/hooks/use-voice-chat';

interface CallSidebarProps {
  companionName: string;
  companionAvatarUrl: string | null;
  voiceState: VoiceChatState;
  isMuted: boolean;
  agentMessage: string;
  userTranscript: string;
  onEndCall: () => void;
  onToggleMute: () => void;
  getInputFrequencyData?: () => Uint8Array | undefined;
  getOutputFrequencyData?: () => Uint8Array | undefined;
}

/**
 * Inline sidebar UI displayed during an active voice call.
 * Uses the VoiceOrb for real-time audio visualization.
 */
export function CallSidebar({
  companionName,
  companionAvatarUrl,
  voiceState,
  isMuted,
  agentMessage,
  userTranscript,
  onEndCall,
  onToggleMute,
  getInputFrequencyData,
  getOutputFrequencyData,
}: CallSidebarProps) {
  const getStatusText = (): string => {
    switch (voiceState) {
      case 'connecting':
        return 'Connecting...';
      case 'listening':
        return 'Listening...';
      case 'thinking':
        return 'Thinking...';
      case 'speaking':
        return companionName + ' is speaking';
      default:
        return '';
    }
  };

  const getStatusColor = (): string => {
    switch (voiceState) {
      case 'listening':
        return 'text-indigo-400';
      case 'speaking':
        return 'text-emerald-400';
      case 'thinking':
        return 'text-amber-400';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex flex-col items-center h-full w-full p-4">
      {/* Companion Avatar */}
      <div className="relative mb-2">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-muted ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-background">
          {companionAvatarUrl ? (
            <img
              src={companionAvatarUrl}
              alt={companionName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
              {companionName.charAt(0)}
            </div>
          )}
        </div>
        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center animate-pulse">
          <Phone className="w-3 h-3 text-white" />
        </div>
      </div>

      {/* Name + Status */}
      <h3 className="text-lg font-semibold text-center mb-1">{companionName}</h3>
      <p className={`text-sm font-medium ${getStatusColor()} mb-3`} role="status" aria-live="polite">
        {getStatusText()}
      </p>

      {/* Voice Orb */}
      <div className="mb-4">
        <VoiceOrb
          state={voiceState}
          getInputFrequencyData={getInputFrequencyData}
          getOutputFrequencyData={getOutputFrequencyData}
          size={140}
        />
      </div>

      {/* Transcript / Agent Message */}
      <div className="flex-1 w-full overflow-hidden mb-4 space-y-2">
        {agentMessage && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-300">
            &ldquo;{agentMessage}&rdquo;
          </div>
        )}
        {userTranscript && (
          <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground italic">
            &ldquo;{userTranscript}&rdquo;
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3 mt-auto">
        {voiceState === 'connecting' ? (
          <Button
            variant="outline"
            size="lg"
            className="rounded-full px-6 h-14 hover:bg-muted"
            onClick={onEndCall}
            aria-label="Cancel call"
          >
            Cancel
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="lg"
              className={`rounded-full w-14 h-14 p-0 ${
                isMuted
                  ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
                  : 'hover:bg-muted'
              }`}
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>

            <Button
              variant="destructive"
              size="lg"
              className="rounded-full w-14 h-14 p-0 bg-red-600 hover:bg-red-700"
              onClick={onEndCall}
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
