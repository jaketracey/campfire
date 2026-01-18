'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
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

  // Refs
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatInput({
  input,
  onInputChange,
  onSend,
  isLoading,
  isRecording,
  voiceModeEnabled,
  hasShownPulse,
  messageReceivedPulseTrigger,
  liveTranscription,
  voiceError,
  webcamError,
  isTTSPlaying,
  inputRef,
  inputContainerRef,
}: ChatInputProps) {
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
          key={messageReceivedPulseTrigger}
          className="flex-1 min-w-0 rounded-xl"
          initial={messageReceivedPulseTrigger > 0 ? { boxShadow: '0 0 0 0 rgba(39, 35, 34, 0)' } : false}
          animate={messageReceivedPulseTrigger > 0 ? {
            boxShadow: [
              '0 0 0 0 rgba(39, 35, 34, 0)',
              '0 0 0 5px rgba(39, 35, 34, 0.9)',
              '0 0 0 5px rgba(39, 35, 34, 0.6)',
              '0 0 0 0 rgba(39, 35, 34, 0)',
            ],
          } : undefined}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && onSend()}
            placeholder={voiceModeEnabled ? 'Type or hold mic to speak...' : 'Type a message...'}
            readOnly={isLoading || isRecording}
            data-testid="chat-input"
            className={`w-full h-12 lg:h-10 text-base lg:text-sm ${
              !hasShownPulse && input.length === 0
                ? 'focus:animate-campfire-pulse'
                : ''
            }`}
          />
        </motion.div>
        <Button
          onClick={onSend}
          onMouseDown={(e) => e.preventDefault()}
          disabled={!input.trim() || isLoading || isRecording}
          className="h-12 w-12 lg:h-10 lg:w-10 flex-shrink-0 rounded-full"
          data-testid="chat-send-button"
        >
          <ArrowRight className="h-7 w-7 lg:h-5 lg:w-5" />
        </Button>
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
