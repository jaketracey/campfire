'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { cn } from '@/lib/utils';

export function VoiceVisualizer({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width = canvas.clientWidth;
    let height = canvas.height = canvas.clientHeight;

    const points: { x: number; y: number; originY: number; phase: number }[] = [];
    const pointCount = 50;
    const spacing = width / (pointCount - 1);

    // Initialize points
    for (let i = 0; i < pointCount; i++) {
      points.push({
        x: i * spacing,
        y: height / 2,
        originY: height / 2,
        phase: i * 0.1,
      });
    }

    // Animation state
    const waveState = {
      amplitude: 20,
      frequency: 0.02,
      speed: 0.05,
      offset: 0,
    };

    // GSAP timeline for "voice activity" simulation
    const tl = gsap.timeline({ repeat: -1, yoyo: true });
    tl.to(waveState, {
      amplitude: 60,
      frequency: 0.04,
      speed: 0.1,
      duration: 2,
      ease: "sine.inOut",
    }).to(waveState, {
      amplitude: 10,
      frequency: 0.02,
      speed: 0.05,
      duration: 1.5,
      ease: "sine.inOut",
    });

    let animationId: number;

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      waveState.offset += waveState.speed;

      ctx.beginPath();
      ctx.moveTo(0, height / 2);

      // Create gradient
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(255, 75, 25, 0)');
      gradient.addColorStop(0.5, 'rgba(255, 75, 25, 0.8)');
      gradient.addColorStop(1, 'rgba(255, 75, 25, 0)');
      
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < pointCount; i++) {
        const point = points[i];
        // Calculate wave position
        const y = point.originY + 
                  Math.sin(i * waveState.frequency + waveState.offset) * waveState.amplitude * 
                  Math.sin(i / pointCount * Math.PI); // Envelope to keep ends pinned
        
        if (i === 0) {
          ctx.moveTo(point.x, y);
        } else {
          // Smooth curve using quadratic bezier
          const prevPoint = points[i - 1];
          const prevY = prevPoint.originY + 
                        Math.sin((i - 1) * waveState.frequency + waveState.offset) * waveState.amplitude * 
                        Math.sin((i - 1) / pointCount * Math.PI);
          
          const cpX = (prevPoint.x + point.x) / 2;
          const cpY = (prevY + y) / 2;
          ctx.quadraticCurveTo(prevPoint.x, prevY, cpX, cpY);
        }
      }
      
      ctx.stroke();
      animationId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      width = canvas.width = canvas.clientWidth;
      height = canvas.height = canvas.clientHeight;
      // Re-space points
      const newSpacing = width / (pointCount - 1);
      points.forEach((p, i) => {
        p.x = i * newSpacing;
        p.originY = height / 2;
      });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      tl.kill();
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className={cn("absolute inset-0 w-full h-full pointer-events-none opacity-60", className)}
    />
  );
}
