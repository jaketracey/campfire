'use client';

import { useEffect, useRef } from 'react';
import type { VoiceChatState } from '@/hooks/use-voice-chat';

interface VoiceOrbProps {
  state: VoiceChatState;
  getInputFrequencyData?: () => Uint8Array | undefined;
  getOutputFrequencyData?: () => Uint8Array | undefined;
  size?: number;
  className?: string;
}

const STATE_COLORS: Record<VoiceChatState, { primary: string; glow: string }> = {
  idle: { primary: '#6b7280', glow: 'rgba(107, 114, 128, 0.3)' },
  connecting: { primary: '#3b82f6', glow: 'rgba(59, 130, 246, 0.4)' },
  listening: { primary: '#6366f1', glow: 'rgba(99, 102, 241, 0.4)' },
  thinking: { primary: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' },
  speaking: { primary: '#10b981', glow: 'rgba(16, 185, 129, 0.4)' },
};

/**
 * Animated orb visualizer for voice chat state.
 * Shows frequency-reactive ring when speaking/listening,
 * pulsing glow when thinking, rotating arc when connecting.
 */
export function VoiceOrb({
  state,
  getInputFrequencyData,
  getOutputFrequencyData,
  size = 160,
  className = '',
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const orbRadius = size * 0.28;
    const ringRadius = size * 0.38;

    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      const colors = STATE_COLORS[state];
      const t = Date.now() / 1000;

      // Glow
      const glowSize = state === 'idle' ? 0.6 : 0.8 + Math.sin(t * 2) * 0.15;
      const gradient = ctx.createRadialGradient(cx, cy, orbRadius * 0.5, cx, cy, orbRadius * 2);
      gradient.addColorStop(0, colors.glow);
      gradient.addColorStop(1, 'transparent');
      ctx.globalAlpha = glowSize;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = 1;

      // Inner orb
      const breathScale = state === 'idle' ? 1 : 1 + Math.sin(t * 1.5) * 0.04;
      ctx.beginPath();
      ctx.arc(cx, cy, orbRadius * breathScale, 0, Math.PI * 2);
      const orbGrad = ctx.createRadialGradient(cx - orbRadius * 0.3, cy - orbRadius * 0.3, 0, cx, cy, orbRadius * breathScale);
      orbGrad.addColorStop(0, lighten(colors.primary, 40));
      orbGrad.addColorStop(1, colors.primary);
      ctx.fillStyle = orbGrad;
      ctx.fill();

      // State-specific effects
      if (state === 'connecting') {
        // Rotating arc
        const angle = (t * 3) % (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, angle, angle + Math.PI * 0.8);
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else if (state === 'listening' || state === 'speaking') {
        // Frequency ring
        const freqData = state === 'listening'
          ? getInputFrequencyData?.()
          : getOutputFrequencyData?.();

        const numBars = 48;
        const barWidth = 3;

        for (let i = 0; i < numBars; i++) {
          const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
          const freqIndex = freqData ? Math.floor((i / numBars) * freqData.length) : 0;
          const amplitude = freqData ? freqData[freqIndex] / 255 : 0.1 + Math.sin(t * 2 + i * 0.3) * 0.1;
          const barHeight = 4 + amplitude * 20;

          const x1 = cx + Math.cos(angle) * (ringRadius - 2);
          const y1 = cy + Math.sin(angle) * (ringRadius - 2);
          const x2 = cx + Math.cos(angle) * (ringRadius + barHeight);
          const y2 = cy + Math.sin(angle) * (ringRadius + barHeight);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = colors.primary;
          ctx.lineWidth = barWidth;
          ctx.lineCap = 'round';
          ctx.globalAlpha = 0.4 + amplitude * 0.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (state === 'thinking') {
        // Pulsing ring
        const pulse = 0.5 + Math.sin(t * 3) * 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2;
        ctx.globalAlpha = pulse;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [state, size, getInputFrequencyData, getOutputFrequencyData]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className={className}
    />
  );
}

function lighten(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0x00ff) + amount);
  const b = Math.min(255, (num & 0x0000ff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}
