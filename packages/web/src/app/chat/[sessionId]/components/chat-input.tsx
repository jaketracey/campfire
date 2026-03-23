'use client';

import { motion, useAnimationControls } from 'framer-motion';
import { useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, SkipForward } from 'lucide-react';

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isRecording: boolean;
  voiceModeEnabled: boolean;
  hasShownPulse: boolean;
  messageReceivedPulseTrigger: number;

  // Voice
  liveTranscription: string;
  voiceError: string | null;
  webcamError: string | null;

  // TTS
  isTTSPlaying: boolean;

  // Companion switching (mobile)
  onSwitchCompanion?: () => void;
  isSwitchingCompanion?: boolean;
  isDemo?: boolean;

  // Refs
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  inputContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatInput({
  input,
  onInputChange,
  onSend,
  isRecording,
  voiceModeEnabled,
  hasShownPulse,
  messageReceivedPulseTrigger,
  liveTranscription,
  voiceError,
  webcamError,
  isTTSPlaying,
  onSwitchCompanion,
  isSwitchingCompanion,
  isDemo,
  inputRef,
  inputContainerRef,
}: ChatInputProps) {
  const controls = useAnimationControls();
  const hassentFirstMessage = useRef(false);

  const autoResize = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 5 * 24; // ~5 lines
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [inputRef]);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  useEffect(() => {
    if (messageReceivedPulseTrigger > 0) {
      hassentFirstMessage.current = true;
      controls.start({
        boxShadow: [
          '0 0 0 0 rgba(39, 35, 34, 0)',
          '0 0 0 5px rgba(39, 35, 34, 0.9)',
          '0 0 0 5px rgba(39, 35, 34, 0.6)',
          '0 0 0 0 rgba(39, 35, 34, 0)',
        ],
        transition: { duration: 0.8, ease: 'easeOut' },
      });
    }
  }, [messageReceivedPulseTrigger, controls]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isRecording) {
      e.preventDefault();
      onSend();
    }
  }, [isRecording, onSend]);

  return (
    <div ref={inputContainerRef} className="py-4 px-0 lg:px-4 bg-background z-40">
      {/* Live transcription display */}
      {liveTranscription && (
        <div className="w-full lg:max-w-4xl lg:mx-auto mb-2" data-testid="live-transcription">
          <Card className="p-2 bg-muted/50 border-dashed">
            <p className="text-sm text-muted-foreground italic">{liveTranscription}</p>
          </Card>
        </div>
      )}

      {/* Voice error display */}
      {voiceError && (
        <div className="w-full lg:max-w-4xl lg:mx-auto mb-2">
          <Card className="p-2 bg-destructive/10 border-destructive/50">
            <p className="text-sm text-destructive">{voiceError}</p>
          </Card>
        </div>
      )}

      {/* Webcam error display */}
      {webcamError && (
        <div className="w-full lg:max-w-4xl lg:mx-auto mb-2">
          <Card className="p-2 bg-destructive/10 border-destructive/50">
            <p className="text-sm text-destructive">{webcamError}</p>
          </Card>
        </div>
      )}

      <div className="flex gap-2 w-full lg:max-w-4xl lg:mx-auto">
        <motion.div
          className="flex-1 min-w-0 rounded-xl"
          animate={controls}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={voiceModeEnabled ? 'Type or hold mic to speak...' : 'Type a message...'}
            readOnly={isRecording}
            rows={1}
            data-testid="chat-input"
            className={`flex w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base lg:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[5px] focus-visible:ring-muted disabled:cursor-not-allowed disabled:opacity-50 resize-none min-h-[48px] lg:min-h-[40px] ${
              !hasShownPulse && input.length === 0
                ? 'focus:animate-campfire-pulse'
                : ''
            }`}
          />
        </motion.div>
        <Button
          onClick={onSend}
          onMouseDown={(e) => e.preventDefault()}
          disabled={!input.trim() || isRecording}
          className="h-12 w-12 lg:h-10 lg:w-10 flex-shrink-0 rounded-full"
          data-testid="chat-send-button"
        >
          <ArrowRight className="h-7 w-7 lg:h-5 lg:w-5" />
        </Button>
        {/* Next companion button - mobile only */}
        {onSwitchCompanion && !isDemo && (
          <Button
            onClick={onSwitchCompanion}
            onMouseDown={(e) => e.preventDefault()}
            disabled={isSwitchingCompanion}
            variant="outline"
            className="h-12 w-12 flex-shrink-0 rounded-full lg:hidden"
            data-testid="next-companion-button"
          >
            <SkipForward className={`h-6 w-6 ${isSwitchingCompanion ? 'animate-pulse' : ''}`} />
          </Button>
        )}
      </div>

      {/* TTS playback indicator */}
      {isTTSPlaying && (
        <div className="w-full lg:max-w-4xl lg:mx-auto mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="tts-indicator">
          <div className="flex gap-1 items-end h-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <motion.div
                key={i}
                className="w-1 bg-campfire-500 rounded-full"
                animate={{
                  height: [4, 16, 8, 12, 4],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                  delay: i * 0.1,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
          <span>Speaking...</span>
        </div>
      )}
    </div>
  );
}
