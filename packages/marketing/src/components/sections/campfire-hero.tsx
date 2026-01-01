'use client';

import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Sparkles, MessageCircle, Share2, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

gsap.registerPlugin(ScrollTrigger);

export function CampfireHero() {
    const containerRef = useRef<HTMLDivElement>(null);
    const fireRef = useRef<HTMLDivElement>(null);
    const sparksRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            // Fire pulsing animation (idle)
            gsap.to('.fire-glow', {
                scale: 1.1,
                opacity: 0.8,
                duration: 2,
                repeat: -1,
                yoyo: true,
                ease: 'sine.inOut',
            });

            // Sparks floating up (idle)
            gsap.to('.spark', {
                y: -100,
                opacity: 0,
                duration: 'random(2, 4)',
                stagger: {
                    amount: 2,
                    repeat: -1,
                },
                ease: 'power1.out',
            });

            // Floating Avatars (idle 3D)
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
                stagger: {
                    amount: 2,
                }
            });

            // ScrollTrigger effects
            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: containerRef.current,
                    start: 'top top',
                    end: 'bottom top',
                    scrub: 1,
                },
            });

            // Fire expands and intensifies on scroll
            tl.to(fireRef.current, {
                scale: 1.5,
                y: 100,
                opacity: 0.5,
            }, 0);

            // Sparks spread out more on scroll
            tl.to(sparksRef.current, {
                y: -200,
                scale: 1.2,
            }, 0);

        }, containerRef);

        return () => ctx.revert();
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative min-h-screen w-full overflow-hidden bg-[#0a0a0a] flex flex-col items-center justify-center text-white"
        >
            {/* Background Gradients */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/50 to-[#0a0a0a]" />
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(255,87,34,0.1),transparent_70%)]" />

            {/* Main Content */}
            <div className="relative z-10 container px-4 md:px-6 flex flex-col items-center text-center space-y-8">

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
                {/* Heading */}
                <div className="relative z-10" style={{ perspective: '800px', transformStyle: 'preserve-3d' }}>
                    {/* Floating Avatars around heading - Larger, Spread further, 3D Fix applied */}
                    <div className="absolute -left-56 -top-40 hidden lg:block md:w-64 md:h-64" style={{ transformStyle: 'preserve-3d' }}>
                        <motion.img
                            src="/avatars/avatar-1.png"
                            alt="AI Avatar"
                            className="floating-avatar w-full h-full object-contain rounded-2xl shadow-glow-lg border border-white/10"
                            initial={{ opacity: 0, scale: 0.5, z: -200 }}
                            animate={{ opacity: 1, scale: 1, z: 0 }}
                            transition={{ duration: 1, delay: 0.5 }}
                        />
                    </div>
                    <div className="absolute -right-72 -top-20 hidden lg:block md:w-72 md:h-72" style={{ transformStyle: 'preserve-3d' }}>
                        <motion.img
                            src="/avatars/avatar-2.png"
                            alt="AI Avatar"
                            className="floating-avatar w-full h-full object-contain rounded-full shadow-glow-lg border border-white/10"
                            initial={{ opacity: 0, scale: 0.5, z: -300 }}
                            animate={{ opacity: 1, scale: 1, z: 0 }}
                            transition={{ duration: 1, delay: 0.7 }}
                        />
                    </div>
                    <div className="absolute -left-80 bottom-0 hidden lg:block md:w-56 md:h-56" style={{ transformStyle: 'preserve-3d' }}>
                        <motion.img
                            src="/avatars/avatar-3.png"
                            alt="AI Avatar"
                            className="floating-avatar w-full h-full object-contain rounded-3xl shadow-glow-lg border border-white/10"
                            initial={{ opacity: 0, scale: 0.5, z: -100 }}
                            animate={{ opacity: 1, scale: 1, z: 0 }}
                            transition={{ duration: 1, delay: 0.9 }}
                        />
                    </div>
                    <div className="absolute -right-32 bottom-20 hidden lg:block md:w-60 md:h-60" style={{ transformStyle: 'preserve-3d' }}>
                        <motion.img
                            src="/avatars/avatar-4.png"
                            alt="AI Avatar"
                            className="floating-avatar w-full h-full object-contain rounded-xl shadow-glow-lg border border-white/10"
                            initial={{ opacity: 0, scale: 0.5, z: -150 }}
                            animate={{ opacity: 1, scale: 1, z: 0 }}
                            transition={{ duration: 1, delay: 1.1 }}
                        />
                    </div>

                    <motion.h1
                        className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter text-white max-w-4xl mx-auto"
                        initial="hidden"
                        animate="visible"
                        aria-label="Gather 'Round the Digital Fire"
                        variants={{
                            visible: {
                                transition: {
                                    staggerChildren: 0.05,
                                    delayChildren: 0.2
                                }
                            }
                        }}
                    >
                        {/* Line 1: Gather 'Round the */}
                        <span className="block mb-2">
                            {Array.from("Gather 'Round the").map((char, index) => (
                                <motion.span
                                    key={index}
                                    className="inline-block"
                                    variants={{
                                        hidden: { opacity: 0, y: 20, filter: 'blur(10px)' },
                                        visible: {
                                            opacity: 1,
                                            y: 0,
                                            filter: 'blur(0px)',
                                            transition: {
                                                duration: 0.4,
                                                ease: "easeOut"
                                            }
                                        }
                                    }}
                                >
                                    {char === " " ? "\u00A0" : char}
                                </motion.span>
                            ))}
                        </span>

                        {/* Line 2: Digital Fire */}
                        <span className="block relative">
                            {Array.from("Digital Fire").map((char, index) => (
                                <motion.span
                                    key={index}
                                    className="inline-block"
                                    style={{
                                        color: index >= 8 ? '#f97316' : undefined,
                                        textShadow: index >= 8 ? '0 0 15px rgba(249,115,22,0.5)' : undefined
                                    }}
                                    variants={{
                                        hidden: { opacity: 0, scale: 0.8, y: 20, filter: 'blur(10px)' },
                                        visible: {
                                            opacity: 1,
                                            scale: 1,
                                            y: 0,
                                            filter: 'blur(0px)',
                                            transition: {
                                                duration: 0.5,
                                                ease: "backOut"
                                            }
                                        }
                                    }}
                                >
                                    {char === " " ? "\u00A0" : char}
                                </motion.span>
                            ))}
                        </span>
                    </motion.h1>
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
                    className="flex flex-col sm:flex-row gap-4 pt-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.8 }}
                >
                    <Button
                        size="lg"
                        className="h-12 px-8 rounded-full bg-orange-600 hover:bg-orange-700 text-white shadow-[0_0_20px_rgba(234,88,12,0.3)] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(234,88,12,0.5)]"
                    >
                        Start Your Free Trial
                    </Button>
                    <Button
                        variant="outline"
                        size="lg"
                        className="h-12 px-8 rounded-full border-gray-800 bg-black/50 text-gray-300 hover:bg-white/10 hover:text-white backdrop-blur-sm transition-all hover:scale-105"
                    >
                        View Demo
                    </Button>
                </motion.div>
            </div>

            {/* Campfire Visuals */}
            <div
                ref={fireRef}
                className="absolute bottom-[-5%] md:bottom-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[700px] pointer-events-none flex items-end justify-center"
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

                {/* Fire Container with Filter */}
                <div className="relative w-full h-full flex items-end justify-center" style={{ filter: 'url(#heat)' }}>
                    {/* Layered Flames */}
                    <div className="absolute bottom-0 w-[400px] h-[500px] bg-gradient-to-t from-orange-600 via-orange-500/50 to-transparent rounded-[50%_50%_20%_20%] blur-3xl animate-pulse-slow opacity-60" />
                    <div className="absolute bottom-10 w-[300px] h-[400px] bg-gradient-to-t from-red-600 via-orange-400/50 to-transparent rounded-[50%_50%_30%_30%] blur-2xl animate-float-fast opacity-80" />
                    <div className="absolute bottom-20 w-[150px] h-[300px] bg-gradient-to-t from-yellow-400 via-orange-300 to-transparent rounded-[50%_50%_50%_50%] blur-xl animate-float opacity-90" />
                    <div className="absolute bottom-32 w-[60px] h-[150px] bg-white rounded-full blur-md opacity-40 animate-pulse" />
                </div>

                {/* Ground Glow */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-orange-900/40 rounded-full blur-[100px]" />

                {/* Dynamic Sparks */}
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

                    {/* Floating Communication Icons (Upgraded) */}
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
