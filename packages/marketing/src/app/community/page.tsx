"use client";

import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { useRef, useEffect } from "react";
import { MessageSquare, Users, Globe, Share2, Ghost, Flame } from "lucide-react";
import gsap from "gsap";

export default function CommunityPage() {
    const containerRef = useRef<HTMLDivElement>(null);

    // Floating avatars animation
    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.to(".floating-avatar", {
                y: "random(-20, 20)",
                x: "random(-20, 20)",
                rotation: "random(-10, 10)",
                duration: "random(2, 4)",
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut",
            });
        }, containerRef);
        return () => ctx.revert();
    }, []);

    return (
        <div ref={containerRef} className="min-h-screen bg-black text-white selection:bg-vibes-hot selection:text-white overflow-hidden">

            {/* Background Gradients */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-radial from-vibes-hot/10 to-transparent blur-[100px]" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-radial from-vibes-electric/10 to-transparent blur-[100px]" />
            </div>

            {/* Hero Section */}
            <section className="relative pt-32 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-center">

                {/* Floating Icons/Avatars Background Layer */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {positions.map((pos, i) => (
                        <div
                            key={i}
                            className="floating-avatar absolute text-vibes-neon/20"
                            style={{ left: pos.left, top: pos.top, fontSize: pos.size }}
                        >
                            {pos.icon}
                        </div>
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="relative z-10 text-center max-w-4xl mx-auto"
                >
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-vibes-hot/50 bg-vibes-hot/10 mb-8">
                        <div className="w-2 h-2 rounded-full bg-vibes-hot animate-pulse" />
                        <span className="text-xs font-mono text-vibes-hot uppercase tracking-wider">Live Community</span>
                    </div>

                    <h1 className="font-display text-display-lg md:text-display-2xl font-bold mb-6 leading-none">
                        Find Your <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-vibes-hot to-vibes-neon">
                            Digital Tribe
                        </span>
                    </h1>

                    <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
                        Where 10,000+ creators, devs, and night owls hang out. <br />
                        No gatekeeping. Just good vibes.
                    </p>

                    <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
                        <button className="px-8 py-4 bg-vibes-hot text-white rounded-full font-bold text-lg hover:bg-vibes-hot/90 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-vibes-hot/25">
                            Join Discord
                        </button>
                        <button className="px-8 py-4 bg-white/5 border border-white/10 text-white rounded-full font-bold text-lg hover:bg-white/10 transition-all">
                            Explore Events
                        </button>
                    </div>
                </motion.div>
            </section>

            {/* Grid Features */}
            <section className="py-24 px-6 relative z-10">
                <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
                    <BentoCard
                        title="Always On"
                        desc="24/7 active voice channels and chill sessions."
                        icon={Globe}
                        className="md:col-span-2 bg-gradient-to-br from-vibes-electric/10 to-transparent border-vibes-electric/20"
                    />
                    <BentoCard
                        title="Real Talk"
                        desc="ama's with your favorite creators."
                        icon={MessageSquare}
                        className="bg-zinc-900/50 border-white/10"
                    />
                    <BentoCard
                        title="Collabs"
                        desc="Find your next co-founder or bandmate."
                        icon={Users}
                        className="bg-zinc-900/50 border-white/10"
                    />
                    <BentoCard
                        title="Global"
                        desc="Community members from 100+ countries."
                        icon={Share2}
                        className="md:col-span-2 bg-gradient-to-br from-vibes-neon/10 to-transparent border-vibes-neon/20"
                    />
                </div>
            </section>
        </div>
    );
}

function BentoCard({ title, desc, icon: Icon, className }: { title: string, desc: string, icon: any, className?: string }) {
    return (
        <motion.div
            whileHover={{ y: -5 }}
            className={`p-8 rounded-3xl border backdrop-blur-md flex flex-col justify-between min-h-[250px] ${className}`}
        >
            <div>
                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
                    <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-2xl font-bold mb-2">{title}</h3>
                <p className="text-gray-400">{desc}</p>
            </div>
        </motion.div>
    );
}

const positions = [
    { left: "10%", top: "20%", size: "4rem", icon: <Ghost /> },
    { left: "80%", top: "15%", size: "3rem", icon: <Flame /> },
    { left: "15%", top: "70%", size: "3rem", icon: <Users /> },
    { left: "75%", top: "60%", size: "5rem", icon: <MessageSquare /> },
];
