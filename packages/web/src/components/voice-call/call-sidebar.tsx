'use client';

import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CallVisualizer } from './call-visualizer';
import type { VoiceCallState } from '@/hooks/use-voice-call';

interface CallSidebarProps {
  companionName: string;
  companionAvatarUrl: string | null;
  callState: VoiceCallState;
  isMuted: boolean;
  currentTranscript: string;
  analyserNode: AnalyserNode | null;
  onEndCall: () => void;
  onToggleMute: () => void;
}

/**
 * Inline sidebar UI displayed during an active voice call
 * Replaces the normal sidebar content
 */
export function CallSidebar({
  companionName,
  companionAvatarUrl,
  callState,
  isMuted,
  currentTranscript,
  analyserNode,
  onEndCall,
  onToggleMute,
}: CallSidebarProps) {
  // Status text based on call state
  const getStatusText = (): string => {
    switch (callState) {
      case 'connecting':
        return 'Connecting...';
      case 'listening':
        return 'Listening...';
      case 'speaking':
        return 'Speak now';
      case 'processing':
        return 'Thinking...';
      case 'companion_speaking':
        return companionName;
      default:
        return '';
    }
  };

  // Status color based on call state
  const getStatusColor = (): string => {
    switch (callState) {
      case 'speaking':
        return 'text-emerald-400';
      case 'companion_speaking':
        return 'text-amber-400';
      case 'processing':
        return 'text-indigo-400';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex flex-col items-center h-full w-full p-4">
      {/* Companion Avatar */}
      <div className="relative mb-4">
        <div className="w-24 h-24 rounded-full overflow-hidden bg-muted ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-background">
          {companionAvatarUrl ? (
            <img
              src={companionAvatarUrl}
              alt={companionName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-muted-foreground">
              {companionName.charAt(0)}
            </div>
          )}
        </div>
        {/* Active call indicator */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center animate-pulse">
          <Phone className="w-3 h-3 text-white" />
        </div>
      </div>

      {/* Companion Name */}
      <h3 className="text-lg font-semibold text-center mb-1">{companionName}</h3>

      {/* Call Status */}
      <p className={`text-sm font-medium ${getStatusColor()} mb-4`}>
        {getStatusText()}
      </p>

      {/* Audio Visualizer */}
      <div className="w-full mb-4">
        <CallVisualizer
          analyserNode={analyserNode}
          callState={callState}
          className="w-full"
        />
      </div>

      {/* Current Transcript */}
      <div className="flex-1 w-full overflow-hidden mb-4">
        {currentTranscript && (
          <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground italic">
            "{currentTranscript}"
          </div>
        )}
      </div>

      {/* Call Controls */}
      <div className="flex gap-3 mt-auto">
        {/* Mute Button */}
        <Button
          variant="outline"
          size="lg"
          className={`rounded-full w-14 h-14 p-0 ${
            isMuted
              ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
              : 'hover:bg-muted'
          }`}
          onClick={onToggleMute}
        >
          {isMuted ? (
            <MicOff className="h-6 w-6" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </Button>

        {/* End Call Button */}
        <Button
          variant="destructive"
          size="lg"
          className="rounded-full w-14 h-14 p-0 bg-red-600 hover:bg-red-700"
          onClick={onEndCall}
        >
          <PhoneOff className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}
