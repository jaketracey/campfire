'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Mix of female and male companion images for background animation
const COMPANIONS = [
    // Female companions - diverse ethnicities and body types
    'female/black-athletic-blonde-bS.webp',
    'female/black-curvy-black-bL.webp',
    'female/caucasian-athletic-blonde-bL.webp',
    'female/caucasian-curvy-blonde-bM.webp',
    'female/caucasian-slim-brown-bL.webp',
    'female/east-asian-athletic-black-bL.webp',
    'female/east-asian-curvy-blonde-bM.webp',
    'female/east-asian-slim-fantasy-bL.webp',
    'female/latina-athletic-black-bM.webp',
    'female/latina-curvy-red-bS.webp',
    'female/middle-eastern-athletic-fantasy-bL.webp',
    'female/middle-eastern-curvy-blonde-bS.webp',
    'female/mixed-athletic-red-bL.webp',
    'female/mixed-curvy-black-bS.webp',
    'female/south-asian-athletic-blonde-bL.webp',
    'female/south-asian-curvy-brown-bM.webp',
    'female/south-asian-plus-size-fantasy-bL.webp',
    // Male companions - diverse ethnicities and body types
    'male/black-muscular-black-buildS.webp',
    'male/black-slim-blonde-buildL.webp',
    'male/caucasian-muscular-brown-buildL.webp',
    'male/caucasian-dad-bod-fantasy-buildS.webp',
    'male/east-asian-athletic-blonde-buildL.webp',
    'male/east-asian-muscular-black-buildM.webp',
    'male/latina-muscular-brown-buildM.webp',
    'male/latina-slim-blonde-buildL.webp',
    'male/middle-eastern-muscular-fantasy-buildL.webp',
    'male/middle-eastern-slim-blonde-buildL.webp',
    'male/mixed-muscular-blonde-buildL.webp',
    'male/mixed-slim-brown-buildM.webp',
    'male/south-asian-athletic-brown-buildL.webp',
    'male/south-asian-muscular-fantasy-buildM.webp',
];

export function CompanionBackground() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const rows = containerRef.current.querySelectorAll('.companion-row');

        rows.forEach((row, i) => {
            const direction = i % 2 === 0 ? -1 : 1;
            const duration = 120 + Math.random() * 60; // Slower, more subtle movement

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
    }, []);

    return (
        <div ref={containerRef} className="fixed inset-0 -z-20 overflow-hidden bg-[#050505] flex flex-col justify-around py-12 opacity-[0.08] pointer-events-none">
            {[0, 1, 2, 3].map((rowIndex) => (
                <div
                    key={rowIndex}
                    className="companion-row flex gap-12 whitespace-nowrap"
                    style={{ width: 'fit-content' }}
                >
                    {/* Duplicate once for seamless horizontal loop */}
                    {[...COMPANIONS, ...COMPANIONS].map((img, i) => (
                        <div key={i} className="w-56 h-80 md:w-72 md:h-[420px] relative flex-shrink-0 grayscale">
                            <img
                                src={`/images/companions/${img}`}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover rounded-3xl border border-white/10"
                            />
                        </div>
                    ))}
                </div>
            ))}
            {/* Heavy vignette and gradients */}
            <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_20%,black_100%)]" />
        </div>
    );
}
