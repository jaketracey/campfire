'use client';

import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

export function OnboardingLogo() {
    const [isHovered, setIsHovered] = useState(false);
    const [isHidden, setIsHidden] = useState(false);
    const logoRef = useRef<HTMLAnchorElement>(null);

    const text = "Campfire";

    // Buffer space in pixels for intersection detection
    const BUFFER = 20;

    useEffect(() => {
        const checkIntersection = () => {
            const logo = logoRef.current;
            const stepIndicator = document.getElementById('step-indicator');

            if (!logo || !stepIndicator) {
                setIsHidden(false);
                return;
            }

            const logoRect = logo.getBoundingClientRect();
            const stepRect = stepIndicator.getBoundingClientRect();

            // Check if the rectangles intersect (with buffer)
            const intersects = !(
                logoRect.right + BUFFER < stepRect.left ||
                logoRect.left - BUFFER > stepRect.right ||
                logoRect.bottom + BUFFER < stepRect.top ||
                logoRect.top - BUFFER > stepRect.bottom
            );

            setIsHidden(intersects);
        };

        // Check on mount
        checkIntersection();

        // Check on scroll
        window.addEventListener('scroll', checkIntersection, { passive: true });
        // Also check on resize
        window.addEventListener('resize', checkIntersection, { passive: true });

        return () => {
            window.removeEventListener('scroll', checkIntersection);
            window.removeEventListener('resize', checkIntersection);
        };
    }, []);

    return (
        <motion.div
            animate={{ opacity: isHidden ? 0 : 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
        >
        <Link
            ref={logoRef}
            href="/"
            className="flex items-center gap-2 group relative z-50 text-white"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="relative">
                <div className="relative z-10">
                    <Flame className={`h-8 w-8 transition-colors duration-300 ${isHovered ? 'text-transparent' : 'text-campfire-500'}`} />
                </div>

                {/* Animated Gradient Mask for Flame */}
                {isHovered && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 z-20 pointer-events-none"
                        style={{
                            maskImage: 'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWZsYW1lIj48cGF0aCBkPSJNOC41IDE0LjVBMi41IDIuNSAwIDAgMCAxMSAxMmMyLTAuNSAyLjUtMiA1LTIgMS4zIDAgMi42IDEuNiA0LjUgMS42IDIuNSAwIDQtMy4zIDQtNiAwLTMuOC00LjYtNi04LjYtNi00IDAtNiAzLTYgMyAwIDMuNSA0IDUuNSA2IDguNSAxIC41IDIuNSA1LjYgMi42IDcuNSAwIDItMiAzLTQuMiAzLTUuNSAwLTIuNSAyLTYuNSAyLTcuNSIvPjwvc3ZnPg==")',
                            maskSize: 'contain',
                            maskRepeat: 'no-repeat',
                            maskPosition: 'center',
                            WebkitMaskImage: 'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWZsYW1lIj48cGF0aCBkPSJNOC41IDE0LjVBMi41IDIuNSAwIDAgMCAxMSAxMmMyLTAuNSAyLjUtMiA1LTIgMS4zIDAgMi42IDEuNiA0LjUgMS42IDIuNSAwIDQtMy4zIDQtNiAwLTMuOC00LjYtNi04LjYtNi00IDAtNiAzLTYgMyAwIDMuNSA0IDUuNSA2IDguNSAxIC41IDIuNSA1LjYgMi42IDcuNSAwIDItMiAzLTQuMiAzLTUuNSAwLTIuNSAyLTYuNSAyLTcuNSIvPjwvc3ZnPg==")',
                            WebkitMaskSize: 'contain',
                            WebkitMaskRepeat: 'no-repeat',
                            WebkitMaskPosition: 'center',
                        }}
                    >
                        <motion.div
                            animate={{
                                background: [
                                    'linear-gradient(0deg, #f59e0b, #ef4444, #ec4899)',
                                    'linear-gradient(180deg, #f59e0b, #ef4444, #ec4899)',
                                    'linear-gradient(360deg, #f59e0b, #ef4444, #ec4899)',
                                ]
                            }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                            className="w-full h-full"
                        />
                    </motion.div>
                )}
            </div>

            <div className="flex">
                {text.split('').map((char, i) => (
                    <motion.span
                        key={i}
                        className="text-xl font-bold inline-block origin-bottom"
                        animate={isHovered ? {
                            opacity: [1, 0],
                            filter: ["blur(0px)", "blur(10px)"],
                            y: [0, -20 - Math.random() * 15],
                            x: [0, (Math.random() - 0.5) * 30],
                            rotate: [0, (Math.random() - 0.5) * 20],
                            scale: [1, 1.5]
                        } : {
                            opacity: 1,
                            filter: "blur(0px)",
                            y: 0,
                            x: 0,
                            rotate: 0,
                            scale: 1
                        }}
                        transition={{
                            duration: 1.2,
                            ease: "easeIn",
                            delay: i * 0.05, // Stagger effect
                            type: "tween"
                        }}
                    >
                        {char}
                    </motion.span>
                ))}
            </div>
        </Link>
        </motion.div>
    );
}
