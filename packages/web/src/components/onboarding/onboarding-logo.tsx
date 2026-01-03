'use client';

import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

export function OnboardingLogo() {
    const [isHidden, setIsHidden] = useState(false);
    const [flameAnimation, setFlameAnimation] = useState({});
    const logoRef = useRef<HTMLAnchorElement>(null);

    // Buffer space in pixels for intersection detection
    const BUFFER = 20;

    useEffect(() => {
        const checkIntersection = () => {
            const logo = logoRef.current;
            if (!logo) {
                setIsHidden(false);
                return;
            }

            const logoRect = logo.getBoundingClientRect();

            // Find all elements that should hide the logo when intersecting
            const hideElements = document.querySelectorAll('[data-hides-logo]');

            if (hideElements.length === 0) {
                setIsHidden(false);
                return;
            }

            // Check if logo intersects with any of them
            let intersects = false;
            for (const element of hideElements) {
                const elementRect = element.getBoundingClientRect();
                const doesIntersect = !(
                    logoRect.right + BUFFER < elementRect.left ||
                    logoRect.left - BUFFER > elementRect.right ||
                    logoRect.bottom + BUFFER < elementRect.top ||
                    logoRect.top - BUFFER > elementRect.bottom
                );
                if (doesIntersect) {
                    intersects = true;
                    break;
                }
            }

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

    // Random flame animations - rare and delightful
    useEffect(() => {
        const animations = [
            { scale: [1, 1.15, 1], transition: { duration: 0.4 } },
            { rotate: [0, -8, 8, -4, 0], transition: { duration: 0.5 } },
            { y: [0, -3, 0], transition: { duration: 0.3 } },
            { filter: ['brightness(1)', 'brightness(1.4)', 'brightness(1)'], transition: { duration: 0.6 } },
        ];

        let timeoutId: NodeJS.Timeout;

        const scheduleNext = () => {
            const delay = 30000 + Math.random() * 60000;
            timeoutId = setTimeout(() => {
                const animation = animations[Math.floor(Math.random() * animations.length)];
                setFlameAnimation(animation);
                setTimeout(() => setFlameAnimation({}), 700);
                scheduleNext();
            }, delay);
        };

        scheduleNext();
        return () => clearTimeout(timeoutId);
    }, []);

    return (
        <motion.div
            animate={{ opacity: isHidden ? 0 : 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
        >
        <Link
            ref={logoRef}
            href="/"
            className="relative z-50"
        >
            <motion.div animate={flameAnimation}>
                <Flame className="h-8 w-8 text-campfire-500" />
            </motion.div>
        </Link>
        </motion.div>
    );
}
