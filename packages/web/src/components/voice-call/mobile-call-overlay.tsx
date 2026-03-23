'use client';

import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceOrb } from './voice-orb';
import type { VoiceChatState } from '@/hooks/use-voice-chat';

interface MobileCallOverlayProps {
  companionName: string;
  voiceState: VoiceChatState;
  isMuted: boolean;
  onEndCall: () => void;
  onToggleMute: () => void;
  getInputFrequencyData?: () => Uint8Array | undefined;
  getOutputFrequencyData?: () => Uint8Array | undefined;
}

/**
 * Floating overlay for mobile users during an active voice call.
 * Displays call status, a compact voice orb, mute toggle, and end call button.
 * Only visible on screens below the `lg` breakpoint.
 */
export function MobileCallOverlay({
  companionName,
  voiceState,
  isMuted,
  onEndCall,
  onToggleMute,
  getInputFrequencyData,
  getOutputFrequencyData,
}: MobileCallOverlayProps) {
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
    <div className="fixed bottom-32 left-4 right-4 z-50 lg:hidden">
      <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl p-4 shadow-2xl">
        {/* Top row: orb + status */}
        <div className="flex items-center gap-3 mb-3">
          {/* Compact voice orb */}
          <div className="shrink-0">
            <VoiceOrb
              state={voiceState}
              getInputFrequencyData={getInputFrequencyData}
              getOutputFrequencyData={getOutputFrequencyData}
              size={56}
            />
          </div>

          {/* Status info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <p className="text-sm font-semibold text-white truncate">
                {companionName}
              </p>
            </div>
            <p
              className={`text-xs font-medium mt-0.5 ${getStatusColor()}`}
              role="status"
              aria-live="polite"
            >
              {getStatusText()}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {voiceState === 'connecting' ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 rounded-full border-white/20 text-white hover:bg-white/10"
              onClick={onEndCall}
              aria-label="Cancel call"
            >
              Cancel
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className={`rounded-full w-10 h-10 p-0 border-white/20 ${
                  isMuted
                    ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
                    : 'text-white hover:bg-white/10'
                }`}
                onClick={onToggleMute}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>

              <Button
                variant="destructive"
                size="sm"
                className="flex-1 rounded-full bg-red-600 hover:bg-red-700 h-10"
                onClick={onEndCall}
                aria-label="End call"
              >
                <PhoneOff className="h-4 w-4 mr-1.5" />
                End Call
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
