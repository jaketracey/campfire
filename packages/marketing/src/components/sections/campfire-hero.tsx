'use client';

import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/lib/constants';

gsap.registerPlugin(ScrollTrigger);

const COMPANIONS = [
    'avatar-1.png', 'avatar-2.png', 'avatar-3.png', 'avatar-4.png',
    'avatar-5.png', 'avatar-6.png', 'avatar-7.png', 'avatar-8.png',
    'avatar-9.png', 'avatar-10.png', 'avatar-11.png', 'avatar-12.png',
];

export function CampfireHero() {
    const containerRef = useRef<HTMLDivElement>(null);
    const bgRef = useRef<HTMLDivElement>(null);
    const textContainerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            // --- Background Scrolling Animation ---
            if (bgRef.current) {
                const rows = bgRef.current.querySelectorAll('.companion-row');
                rows.forEach((row, i) => {
                    const direction = i % 2 === 0 ? -1 : 1;
                    const duration = 120 + Math.random() * 60;

                    if (direction === -1) {
                        gsap.set(row, { x: '0%' });
                        gsap.to(row, {
                            x: '-50%',
                            duration: duration,
                            repeat: -1,
                            ease: 'none',
                        });
                    } else {
                        gsap.set(row, { x: '-50%' });
                        gsap.to(row, {
                            x: '0%',
                            duration: duration,
                            repeat: -1,
                            ease: 'none',
                        });
                    }
                });
            }

            // --- Main Text Animation Entrance ---
            const chars = gsap.utils.toArray('.hero-char');
            gsap.set(chars, {
                opacity: 0,
                z: () => gsap.utils.random(-1000, -200),
                y: () => gsap.utils.random(-100, 100),
                x: () => gsap.utils.random(-100, 100),
                rotationX: () => gsap.utils.random(-90, 90),
                rotationY: () => gsap.utils.random(-90, 90),
                rotationZ: () => gsap.utils.random(-20, 20),
                filter: 'blur(10px)',
            });

            gsap.to(chars, {
                duration: 2.5,
                opacity: 1,
                x: 0,
                y: 0,
                z: 0,
                rotationX: 0,
                rotationY: 0,
                rotationZ: 0,
                filter: 'blur(0px)',
                ease: 'elastic.out(1, 0.75)',
                stagger: {
                    amount: 1,
                    from: 'random',
                },
                delay: 0.5,
            });

            // --- Continuous "Ember" wave effect ---
            const emberTl = gsap.timeline({ repeat: -1, repeatDelay: 3 });
            emberTl.to(chars, {
                color: '#ffcc00',
                textShadow: '0 0 20px #ffcc00, 0 0 40px #ff4d00',
                scale: 1.1,
                y: -5,
                duration: 0.2,
                stagger: {
                    each: 0.05,
                    from: "start",
                    yoyo: true,
                    repeat: 1,
                },
                ease: "power2.inOut"
            });

            // --- Mouse Move / Interactive Magnetic Effect ---
            const handleMouseMove = (e: MouseEvent) => {
                const mouseX = e.clientX;
                const mouseY = e.clientY;

                chars.forEach((char: any) => {
                    const rect = char.getBoundingClientRect();
                    const charCenterX = rect.left + rect.width / 2;
                    const charCenterY = rect.top + rect.height / 2;

                    const distOp = Math.sqrt(
                        Math.pow(mouseX - charCenterX, 2) +
                        Math.pow(mouseY - charCenterY, 2)
                    );

                    const maxDist = 200;

                    if (distOp < maxDist) {
                        const force = (maxDist - distOp) / maxDist;
                        const moveX = (mouseX - charCenterX) * force * 0.3;
                        const moveY = (mouseY - charCenterY) * force * 0.3;

                        gsap.to(char, {
                            x: -moveX,
                            y: -moveY,
                            duration: 0.5,
                            ease: 'power2.out'
                        });
                    } else {
                        gsap.to(char, {
                            x: 0,
                            y: 0,
                            duration: 0.5,
                            ease: 'power2.out'
                        });
                    }
                });
            };

            window.addEventListener('mousemove', handleMouseMove);

            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
            }

        }, containerRef);

        return () => ctx.revert();
    }, []);

    const splitText = (text: string) => {
        return text.split('').map((char, i) => (
            <span
                key={i}
                className={`hero-char inline-block relative ${char === ' ' ? 'w-4 md:w-6' : ''}`}
                style={{
                    perspective: '1000px',
                    transformStyle: 'preserve-3d'
                }}
            >
                {char === ' ' ? '\u00A0' : char}
            </span>
        ));
    };

    return (
        <div
            ref={containerRef}
            className="relative min-h-screen w-full overflow-hidden bg-[#0a0a0a] flex flex-col items-center justify-center text-white"
        >
            {/* Background Gradients */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/50 to-[#0a0a0a] z-10" />
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(255,87,34,0.1),transparent_70%)] z-10" />

            {/* Scrolling Companions Background */}
            <div ref={bgRef} className="absolute inset-0 z-0 overflow-hidden flex flex-col justify-between py-12 opacity-[0.15] pointer-events-none grayscale">
                {[0, 1, 2].map((rowIndex) => (
                    <div
                        key={rowIndex}
                        className="companion-row flex gap-8 whitespace-nowrap"
                        style={{ width: 'fit-content' }}
                    >
                        {/* Quadruple the array for seamless loop */}
                        {[...COMPANIONS, ...COMPANIONS, ...COMPANIONS, ...COMPANIONS].map((img, i) => (
                            <div key={i} className="w-48 h-64 md:w-64 md:h-80 relative flex-shrink-0">
                                <img
                                    src={`/avatars/${img}`}
                                    alt=""
                                    className="w-full h-full object-cover rounded-2xl border border-white/10"
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            {/* Main Content */}
            <div className="relative z-20 container px-4 md:px-6 flex flex-col items-center text-center space-y-8 select-none">
                {/* Animated Badge */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="inline-flex items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-sm font-medium text-orange-400 backdrop-blur-xl"
                >
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span>Ignite Your Conversations</span>
                </motion.div>

                {/* Heading */}
                <div
                    ref={textContainerRef}
                    className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-white max-w-5xl mx-auto cursor-default"
                    aria-label="Gather 'Round the Digital Fire"
                    style={{ perspective: '2000px', transformStyle: 'preserve-3d' }}
                >
                    <div className="block mb-2">
                        {splitText("Gather 'Round the")}
                    </div>
                    <div className="block relative">
                        {"Digital Fire".split('').map((char, i) => (
                            <span
                                key={i}
                                className={`hero-char inline-block relative ${char === ' ' ? 'w-4 md:w-6' : ''} ${i >= 8 ? 'text-orange-500' : ''}`}
                                style={{
                                    perspective: '1000px',
                                    transformStyle: 'preserve-3d',
                                    textShadow: i >= 8 ? '0 0 25px rgba(249,115,22,0.6)' : undefined
                                }}
                            >
                                {char === ' ' ? '\u00A0' : char}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Description */}
                <motion.p
                    className="text-lg md:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed drop-shadow-lg"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 1.2 }}
                >
                    Experience a new era of communication where warmth meets technology.
                    Connect, share, and grow your community in a space designed for human connection.
                </motion.p>

                {/* CTA Actions */}
                <motion.div
                    className="flex flex-col sm:flex-row gap-4 pt-4 relative z-20"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.8 }}
                >
                    <Button
                        size="lg"
                        className="h-12 px-8 rounded-full bg-orange-600 hover:bg-orange-700 text-white shadow-[0_0_20px_rgba(234,88,12,0.3)] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(234,88,12,0.5)]"
                        asChild
                    >
                        <Link href={`${siteConfig.appUrl}/onboard`}>
                            Start Your Free Trial
                        </Link>
                    </Button>
                </motion.div>
            </div>

            {/* Bottom fade for smooth transition */}
            <div className="absolute bottom-0 left-0 w-full h-48 bg-gradient-to-t from-gray-950 via-gray-950/80 to-transparent z-10 pointer-events-none" />
        </div>
    );
}

