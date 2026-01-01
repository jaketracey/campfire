'use client';

import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Sparkles, MessageCircle, Share2, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/lib/constants';

gsap.registerPlugin(ScrollTrigger);

export function CampfireHero() {
    const containerRef = useRef<HTMLDivElement>(null);
    const fireRef = useRef<HTMLDivElement>(null);
    const sparksRef = useRef<HTMLDivElement>(null);
    const textContainerRef = useRef<HTMLDivElement>(null);

    // Dynamic Avatar Logic (Preserved)
    const AVATAR_COUNT = 12;
    const [indices, setIndices] = useState<number[]>([]);

    const avatarPositions = [
        { className: 'w-24 h-24 md:w-64 md:h-64', left: '5%', top: '10%' },
        { className: 'w-32 h-32 md:w-72 md:h-72', right: '5%', top: '15%' },
        { className: 'w-20 h-20 md:w-56 md:h-56', left: '8%', bottom: '20%' },
        { className: 'w-28 h-28 md:w-60 md:h-60', right: '10%', bottom: '25%' },
    ];

    useEffect(() => {
        const initial = [0, 1, 2, 3];
        setIndices(initial);

        const interval = setInterval(() => {
            setIndices(prev => {
                if (prev.length === 0) return [0, 1, 2, 3];
                const next = [...prev];
                const slotToUpdate = Math.floor(Math.random() * 4);
                let nextIdx = Math.floor(Math.random() * AVATAR_COUNT);
                while (next.includes(nextIdx)) {
                    nextIdx = Math.floor(Math.random() * AVATAR_COUNT);
                }
                next[slotToUpdate] = nextIdx;
                return next;
            });
        }, 3000);

        return () => clearInterval(interval);
    }, []);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            // --- Original Background Animations (Preserved) ---
            gsap.to('.fire-glow', {
                scale: 1.1,
                opacity: 0.8,
                duration: 2,
                repeat: -1,
                yoyo: true,
                ease: 'sine.inOut',
            });

            gsap.to('.spark', {
                y: -100,
                opacity: 0,
                duration: 'random(2, 4)',
                stagger: { amount: 2, repeat: -1 },
                ease: 'power1.out',
            });

            gsap.to('.floating-avatar', {
                y: 'random(-60, 60)',
                x: 'random(-40, 40)',
                z: 'random(-150, 150)',
                rotationX: 'random(-25, 25)',
                rotationY: 'random(-25, 25)',
                rotationZ: 'random(-15, 15)',
                duration: 'random(5, 7)',
                repeat: -1,
                yoyo: true,
                ease: 'sine.inOut',
                stagger: { amount: 2 }
            });

            // --- Main Text Animation Entrance ---
            const chars = gsap.utils.toArray('.hero-char');
            // Random start positions in 3D space
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
                    amount: 1, // Total drag time
                    from: 'random', // Random order of appearance
                },
                delay: 0.5,
            });

            // --- Continuous "Ember" wave effect ---
            // A subtle glow that travels across the text
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

                    const maxDist = 200; // range of effect

                    if (distOp < maxDist) {
                        const force = (maxDist - distOp) / maxDist; // 0 to 1
                        const moveX = (mouseX - charCenterX) * force * 0.3;
                        const moveY = (mouseY - charCenterY) * force * 0.3;

                        gsap.to(char, {
                            x: -moveX, // repel
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

            // ScrollTrigger effects (Preserved)
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: containerRef.current,
                    start: 'top top',
                    end: 'bottom top',
                    scrub: 1,
                },
            });

            tl.to(fireRef.current, { scale: 1.5, y: 100, opacity: 0.5 }, 0);
            tl.to(sparksRef.current, { y: -200, scale: 1.2 }, 0);

            // Cleanup listener
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
            }

        }, containerRef);

        return () => ctx.revert();
    }, []);

    const splitText = (text: string, isFire = false) => {
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
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/50 to-[#0a0a0a]" />
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(255,87,34,0.1),transparent_70%)]" />

            {/* Dynamic Floating Avatars Pool */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}>
                <AnimatePresence mode="popLayout">
                    {indices.map((avatarIdx, slotIdx) => {
                        const pos = avatarPositions[slotIdx];
                        return (
                            <motion.div
                                key={`slot-${slotIdx}-${avatarIdx}`}
                                initial={{ opacity: 0, scale: 0.5, z: -200, rotateY: 30 }}
                                animate={{
                                    opacity: 1,
                                    scale: 1,
                                    z: 0,
                                    rotateY: 0,
                                    transition: { duration: 1.5, ease: "easeOut" }
                                }}
                                exit={{
                                    opacity: 0,
                                    scale: 1.2,
                                    z: 100,
                                    rotateY: -30,
                                    transition: { duration: 1, ease: "easeIn" }
                                }}
                                className={cn(
                                    "absolute floating-avatar z-10",
                                    pos.className
                                )}
                                style={{
                                    transformStyle: 'preserve-3d',
                                    left: pos.left,
                                    top: pos.top,
                                    right: pos.right,
                                    bottom: pos.bottom
                                }}
                            >
                                <div className="relative w-full h-full">
                                    <img
                                        src={`/avatars/avatar-${avatarIdx + 1}.png`}
                                        alt="AI Avatar"
                                        className="w-full h-full object-contain rounded-3xl shadow-[0_0_30px_rgba(255,255,255,0.15)] border border-white/10 backdrop-blur-[2px]"
                                    />
                                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-orange-500/20 to-transparent pointer-events-none" />
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
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
                    className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-white max-w-4xl mx-auto cursor-default"
                    aria-label="Gather 'Round the Digital Fire"
                    style={{ perspective: '2000px', transformStyle: 'preserve-3d' }}
                >
                    <div className="block mb-2">
                        {splitText("Gather 'Round the")}
                    </div>
                    <div className="block relative">
                        {/* We manually apply the orange color class to 'Digital Fire' parts if we want, but GSAP handles it too. 
                            Let's keep the split logic simple as above, but maybe apply a specific class for the fire part?
                            Actually, the 'Digital Fire' specific orange styling was in react before. 
                            Let's re-incorporate that effectively. 
                        */}
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
                    className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed"
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

            {/* Campfire Visuals */}
            <div
                ref={fireRef}
                className="absolute bottom-[-5%] md:bottom-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[700px] pointer-events-none flex items-end justify-center z-0"
            >
                {/* SVG Fire Filter */}
                <svg className="hidden">
                    <defs>
                        <filter id="heat">
                            <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="2" result="noise" />
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="15" />
                        </filter>
                    </defs>
                </svg>

                <div className="relative w-full h-full flex items-end justify-center" style={{ filter: 'url(#heat)' }}>
                    <div className="absolute bottom-0 w-[400px] h-[500px] bg-gradient-to-t from-orange-600 via-orange-500/50 to-transparent rounded-[50%_50%_20%_20%] blur-3xl animate-pulse-slow opacity-60" />
                    <div className="absolute bottom-10 w-[300px] h-[400px] bg-gradient-to-t from-red-600 via-orange-400/50 to-transparent rounded-[50%_50%_30%_30%] blur-2xl animate-float-fast opacity-80" />
                    <div className="absolute bottom-20 w-[150px] h-[300px] bg-gradient-to-t from-yellow-400 via-orange-300 to-transparent rounded-[50%_50%_50%_50%] blur-xl animate-float opacity-90" />
                    <div className="absolute bottom-32 w-[60px] h-[150px] bg-white rounded-full blur-md opacity-40 animate-pulse" />
                </div>

                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-orange-900/40 rounded-full blur-[100px]" />

                <div ref={sparksRef} className="absolute inset-0 z-20">
                    {[...Array(30)].map((_, i) => (
                        <div
                            key={`dot-${i}`}
                            className="spark absolute bottom-1/4 left-1/2 rounded-full"
                            style={{
                                width: `${(i % 3) + 2}px`,
                                height: `${(i % 3) + 2}px`,
                                background: i % 5 === 0 ? '#ff4d00' : i % 3 === 0 ? '#ffcc00' : '#ffffff',
                                boxShadow: '0 0 10px #ff9000',
                                left: `${50 + ((i * 37) % 60 - 30)}%`,
                            }}
                        />
                    ))}
                    {[...Array(8)].map((_, i) => (
                        <div
                            key={`icon-${i}`}
                            className="spark absolute bottom-1/3 left-1/2 text-orange-200/40"
                            style={{
                                left: `${50 + ((i * 43) % 80 - 40)}%`,
                                fontSize: `${(i * 9) % 15 + 15}px`,
                                filter: 'drop-shadow(0 0 15px rgba(255,145,0,0.4))'
                            }}
                        >
                            {i % 4 === 0 ? <MessageCircle size={32} /> :
                                i % 4 === 1 ? <Share2 size={32} /> :
                                    i % 4 === 2 ? <Radio size={32} /> : <Sparkles size={32} />}
                        </div>
                    ))}
                </div>
            </div>

            {/* Bottom fade for smooth transition */}
            <div className="absolute bottom-0 left-0 w-full h-48 bg-gradient-to-t from-gray-950 via-gray-950/80 to-transparent z-30 pointer-events-none" />
        </div>
    );
}

