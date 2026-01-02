'use client';

import { useEffect, useRef } from 'react';
import type { VoiceCallState } from '@/hooks/use-voice-call';

interface CallVisualizerProps {
  analyserNode: AnalyserNode | null;
  callState: VoiceCallState;
  className?: string;
}

/**
 * Audio waveform visualizer for voice calls
 * Shows different animations based on call state
 */
export function CallVisualizer({ analyserNode, callState, className = '' }: CallVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Determine color based on state
      let color: string;
      switch (callState) {
        case 'speaking':
          color = '#10b981'; // emerald-500 (user speaking)
          break;
        case 'companion_speaking':
          color = '#f59e0b'; // amber-500 (companion speaking)
          break;
        case 'processing':
          color = '#6366f1'; // indigo-500 (processing)
          break;
        default:
          color = '#6b7280'; // gray-500 (idle/listening)
      }

      if (analyserNode && (callState === 'speaking' || callState === 'companion_speaking')) {
        // Real audio visualization
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;

        ctx.fillStyle = color;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * (height * 0.8);

          // Draw mirrored bars from center
          ctx.fillRect(x, centerY - barHeight / 2, barWidth - 1, barHeight);

          x += barWidth;
          if (x > width) break;
        }
      } else if (callState === 'processing') {
        // Pulsing dots animation for processing
        const time = Date.now() / 200;
        const numDots = 5;
        const dotSpacing = width / (numDots + 1);

        ctx.fillStyle = color;

        for (let i = 0; i < numDots; i++) {
          const phase = (time + i * 0.5) % (Math.PI * 2);
          const scale = 0.5 + Math.sin(phase) * 0.5;
          const radius = 4 * scale;

          ctx.beginPath();
          ctx.arc(dotSpacing * (i + 1), centerY, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Idle wave animation for listening
        const time = Date.now() / 1000;
        const numBars = 20;
        const barWidth = width / numBars;

        ctx.fillStyle = color;

        for (let i = 0; i < numBars; i++) {
          const phase = (time + i * 0.15) % (Math.PI * 2);
          const amplitude = callState === 'listening' ? 8 : 4;
          const barHeight = amplitude + Math.sin(phase) * amplitude;

          ctx.fillRect(
            i * barWidth + 2,
            centerY - barHeight / 2,
            barWidth - 4,
            barHeight
          );
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyserNode, callState]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={60}
      className={`rounded-lg bg-muted/20 ${className}`}
    />
  );
}
