'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(DrawSVGPlugin);
}

interface IgnitingFlameProps {
  size?: number;
  onComplete?: () => void;
  className?: string;
}

export function IgnitingFlame({ size = 96, onComplete, className }: IgnitingFlameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flameRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !flameRef.current || !glowRef.current) return;

    const flame = flameRef.current;
    const glow = glowRef.current;
    const container = containerRef.current;
    const particlesContainer = particlesRef.current;

    // Create main timeline
    const tl = gsap.timeline({
      onComplete: () => {
        // Start idle animation after ignite completes
        startIdleAnimation();
        onComplete?.();
      },
    });

    // Initial state - outline only, no fill
    gsap.set(flame, {
      drawSVG: '0%',
      stroke: '#f97316',
      strokeWidth: 2,
      fill: 'transparent',
    });
    gsap.set(glow, { opacity: 0 });
    gsap.set(container, { filter: 'drop-shadow(0 0 0px rgba(249, 115, 22, 0))' });

    // Phase 1: Draw the outline (spark catching)
    tl.to(flame, {
      drawSVG: '100%',
      duration: 0.4,
      ease: 'power2.inOut',
    });

    // Phase 2: Outline starts glowing (catching fire)
    tl.to(flame, {
      stroke: '#fb923c',
      strokeWidth: 3,
      duration: 0.2,
      ease: 'power1.in',
    }, '-=0.1');

    // Add initial glow
    tl.to(container, {
      filter: 'drop-shadow(0 0 8px rgba(249, 115, 22, 0.6))',
      duration: 0.2,
    }, '-=0.2');

    // Phase 3: Fill starts appearing from bottom (flame igniting)
    tl.to(flame, {
      fill: 'url(#flameGradient)',
      duration: 0.3,
      ease: 'power2.out',
    });

    // Intensify glow as fill appears
    tl.to(container, {
      filter: 'drop-shadow(0 0 20px rgba(249, 115, 22, 0.8)) drop-shadow(0 0 40px rgba(239, 68, 68, 0.5))',
      duration: 0.3,
    }, '-=0.3');

    // Phase 4: Show the hot glow layer
    tl.to(glow, {
      opacity: 0.6,
      duration: 0.2,
    }, '-=0.1');

    // Phase 5: Final burst of intensity
    tl.to(container, {
      filter: 'drop-shadow(0 0 30px rgba(249, 115, 22, 1)) drop-shadow(0 0 60px rgba(239, 68, 68, 0.7)) drop-shadow(0 0 80px rgba(251, 191, 36, 0.4))',
      duration: 0.15,
      ease: 'power2.out',
    });

    // Scale pulse on ignite
    tl.to(container, {
      scale: 1.15,
      duration: 0.15,
      ease: 'power2.out',
    }, '-=0.15');

    tl.to(container, {
      scale: 1,
      duration: 0.3,
      ease: 'elastic.out(1, 0.5)',
    });

    // Settle to ambient glow
    tl.to(container, {
      filter: 'drop-shadow(0 0 20px rgba(249, 115, 22, 0.8)) drop-shadow(0 0 40px rgba(239, 68, 68, 0.4))',
      duration: 0.3,
    }, '-=0.2');

    // Create particles/sparks during ignition
    if (particlesContainer) {
      const createParticle = (delay: number) => {
        const particle = document.createElement('div');
        particle.className = 'absolute rounded-full';

        const isEmber = Math.random() > 0.5;
        const particleSize = isEmber ? Math.random() * 4 + 2 : Math.random() * 3 + 1;

        particle.style.width = `${particleSize}px`;
        particle.style.height = `${particleSize}px`;
        particle.style.background = isEmber
          ? `radial-gradient(circle, #fbbf24 0%, #f97316 50%, #dc2626 100%)`
          : '#fef3c7';
        particle.style.boxShadow = isEmber
          ? '0 0 6px #f97316, 0 0 12px #dc2626'
          : '0 0 4px #fbbf24';

        particlesContainer.appendChild(particle);

        const startX = size / 2 + (Math.random() - 0.5) * 20;
        const startY = size * 0.6;

        gsap.set(particle, {
          x: startX,
          y: startY,
          opacity: 0,
        });

        gsap.to(particle, {
          x: startX + (Math.random() - 0.5) * 60,
          y: startY - Math.random() * 80 - 20,
          opacity: 1,
          duration: 0.15,
          delay,
          ease: 'power2.out',
        });

        gsap.to(particle, {
          opacity: 0,
          scale: 0,
          duration: 0.4,
          delay: delay + 0.15,
          ease: 'power2.in',
          onComplete: () => particle.remove(),
        });
      };

      // Burst of particles during ignition
      for (let i = 0; i < 12; i++) {
        createParticle(0.3 + Math.random() * 0.3);
      }
    }

    // Idle animation - gentle flickering
    const startIdleAnimation = () => {
      // Flame flicker
      gsap.to(flame, {
        scaleX: 0.97,
        scaleY: 1.02,
        duration: 0.15 + Math.random() * 0.1,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        transformOrigin: 'center bottom',
      });

      // Glow pulse
      gsap.to(container, {
        filter: 'drop-shadow(0 0 25px rgba(249, 115, 22, 0.9)) drop-shadow(0 0 50px rgba(239, 68, 68, 0.5))',
        duration: 0.8,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      // Occasional spark
      const sparkInterval = setInterval(() => {
        if (particlesContainer && Math.random() > 0.6) {
          const spark = document.createElement('div');
          spark.className = 'absolute rounded-full';
          spark.style.width = '2px';
          spark.style.height = '2px';
          spark.style.background = '#fef3c7';
          spark.style.boxShadow = '0 0 4px #fbbf24';
          particlesContainer.appendChild(spark);

          const startX = size / 2 + (Math.random() - 0.5) * 15;
          const startY = size * 0.4;

          gsap.fromTo(spark,
            { x: startX, y: startY, opacity: 1 },
            {
              x: startX + (Math.random() - 0.5) * 30,
              y: startY - Math.random() * 40 - 10,
              opacity: 0,
              duration: 0.5,
              ease: 'power2.out',
              onComplete: () => spark.remove(),
            }
          );
        }
      }, 300);

      return () => clearInterval(sparkInterval);
    };

    return () => {
      tl.kill();
      gsap.killTweensOf([flame, glow, container]);
    };
  }, [size, onComplete]);

  return (
    <div ref={containerRef} className={className} style={{ width: size, height: size }}>
      <div ref={particlesRef} className="absolute inset-0 pointer-events-none overflow-visible" />
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10"
      >
        <defs>
          {/* Main flame gradient - bottom to top, red to orange to yellow */}
          <linearGradient id="flameGradient" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="30%" stopColor="#ea580c" />
            <stop offset="60%" stopColor="#f97316" />
            <stop offset="85%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>

          {/* Hot glow gradient */}
          <linearGradient id="glowGradient" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
            <stop offset="40%" stopColor="#fb923c" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fcd34d" stopOpacity="0.6" />
          </linearGradient>

        </defs>

        {/* Main flame path - matches Lucide flame icon */}
        <path
          ref={flameRef}
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Glow layer - slightly larger, blurred effect simulated with opacity */}
        <path
          ref={glowRef}
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
          fill="url(#glowGradient)"
          style={{ filter: 'blur(2px)' }}
        />

      </svg>
    </div>
  );
}
