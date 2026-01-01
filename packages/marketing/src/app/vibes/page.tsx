"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { ArrowRight, Sparkles, Zap, Music, Heart } from "lucide-react";

export default function VibesPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"],
    });

    const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
    const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

    return (
        <div ref={containerRef} className="min-h-screen bg-black text-white overflow-hidden selection:bg-vibes-neon selection:text-white">
            {/* Dynamic Background */}
            <div className="fixed inset-0 z-0">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-vibes-neon/20 rounded-full blur-[120px] animate-float" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-vibes-electric/20 rounded-full blur-[120px] animate-float-fast" />
                <div className="absolute top-[40%] left-[40%] w-[30%] h-[30%] bg-vibes-hot/10 rounded-full blur-[100px] animate-pulse-slow" />
            </div>

            {/* Hero Section */}
            <section className="relative z-10 h-screen flex flex-col items-center justify-center px-6">
                <motion.div
                    style={{ y, opacity }}
                    className="text-center"
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-vibes-neon/50 bg-vibes-neon/10 backdrop-blur-md"
                    >
                        <Sparkles className="w-4 h-4 text-vibes-acid" />
                        <span className="text-sm font-mono tracking-widest uppercase text-vibes-acid">The New Wave</span>
                    </motion.div>

                    <motion.h1
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2, duration: 0.8 }}
                        className="font-display text-display-xl md:text-display-2xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-vibes-electric"
                    >
                        Catch the <br />
                        <span className="text-vibes-neon italic">Vibe Shift</span>
                    </motion.h1>

                    <motion.p
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.4, duration: 0.8 }}
                        className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-12"
                    >
                        Campfire isn't just a platform. It's a movement. <br className="hidden md:block" />
                        Connect, create, and vibe with a community that gets it.
                    </motion.p>

                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="group relative px-8 py-4 bg-white text-black rounded-full font-bold text-lg overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-electric opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        <span className="relative z-10 flex items-center gap-2 group-hover:text-white transition-colors">
                            Join the Vibe <ArrowRight className="w-5 h-5" />
                        </span>
                    </motion.button>
                </motion.div>
            </section>

            {/* Manifesto Section */}
            <section className="relative z-10 py-32 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
                        <div>
                            <motion.h2
                                initial={{ opacity: 0, x: -50 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                className="font-display text-5xl md:text-7xl font-bold mb-8 leading-tight"
                            >
                                Not just <br />
                                another <span className="text-vibes-hot animate-wiggle inline-block">App</span>.
                            </motion.h2>
                            <div className="space-y-6 text-xl text-gray-300">
                                <p>We're building for the creators, the dreamers, and the night owls.</p>
                                <p>No algorithms deciding your fate. Just pure, unfiltered connection.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Card icon={Zap} title="Electric" color="bg-vibes-electric" delay={0.1} />
                            <Card icon={Heart} title="Passion" color="bg-vibes-hot" delay={0.2} />
                            <Card icon={Music} title="Rhythm" color="bg-vibes-neon" delay={0.3} />
                            <Card icon={Sparkles} title="Magic" color="bg-vibes-acid" delay={0.4} />
                        </div>
                    </div>
                </div>
            </section>

            {/* Scroll Text Section */}
            <section className="relative z-10 py-20 overflow-hidden bg-white/5 backdrop-blur-lg">
                <div className="flex whitespace-nowrap animate-float-fast">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center mx-8">
                            <span className="text-8xl font-display font-black text-transparent stroke-text opacity-20">
                                VIBE WITH US
                            </span>
                            <span className="mx-8 text-6xl">🔥</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function Card({ icon: Icon, title, color, delay }: { icon: any, title: string, color: string, delay: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay }}
            whileHover={{ y: -10, rotate: -2 }}
            className={`p-8 rounded-3xl ${color}/10 border border-${color}/20 backdrop-blur-sm hover:border-${color}/50 transition-colors aspect-square flex flex-col items-center justify-center text-center group`}
        >
            <div className={`p-4 rounded-full ${color}/20 mb-4 group-hover:scale-110 transition-transform duration-300`}>
                <Icon className={`w-8 h-8 text-white`} />
            </div>
            <h3 className="font-bold text-xl text-white">{title}</h3>
        </motion.div>
    );
}
