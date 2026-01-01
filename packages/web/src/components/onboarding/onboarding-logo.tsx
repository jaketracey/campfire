'use client';

import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

export function OnboardingLogo() {
    const [isHidden, setIsHidden] = useState(false);
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

    return (
        <motion.div
            animate={{ opacity: isHidden ? 0 : 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
        >
        <Link
            ref={logoRef}
            href="/"
            className="flex items-center gap-2 relative z-50 text-white"
        >
            <Flame className="h-8 w-8 text-campfire-500" />
            <span className="text-xl font-bold">Campfire</span>
        </Link>
        </motion.div>
    );
}
