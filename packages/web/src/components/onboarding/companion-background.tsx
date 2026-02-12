'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Mix of female and male companion images for background animation
const COMPANIONS = [
    // Female companions - diverse ethnicities and body types
    'female/black-athletic-blonde-bS.png',
    'female/black-curvy-black-bL.png',
    'female/caucasian-athletic-blonde-bL.png',
    'female/caucasian-curvy-blonde-bM.png',
    'female/caucasian-slim-brown-bL.png',
    'female/east-asian-athletic-black-bL.png',
    'female/east-asian-curvy-blonde-bM.png',
    'female/east-asian-slim-fantasy-bL.png',
    'female/latina-athletic-black-bM.png',
    'female/latina-curvy-red-bS.png',
    'female/middle-eastern-athletic-fantasy-bL.png',
    'female/middle-eastern-curvy-blonde-bS.png',
    'female/mixed-athletic-red-bL.png',
    'female/mixed-curvy-black-bS.png',
    'female/south-asian-athletic-blonde-bL.png',
    'female/south-asian-curvy-brown-bM.png',
    'female/south-asian-plus-size-fantasy-bL.png',
    // Male companions - diverse ethnicities and body types
    'male/black-muscular-black-buildS.png',
    'male/black-slim-blonde-buildL.png',
    'male/caucasian-muscular-brown-buildL.png',
    'male/caucasian-dad-bod-fantasy-buildS.png',
    'male/east-asian-athletic-blonde-buildL.png',
    'male/east-asian-muscular-black-buildM.png',
    'male/latina-muscular-brown-buildM.png',
    'male/latina-slim-blonde-buildL.png',
    'male/middle-eastern-muscular-fantasy-buildL.png',
    'male/middle-eastern-slim-blonde-buildL.png',
    'male/mixed-muscular-blonde-buildL.png',
    'male/mixed-slim-brown-buildM.png',
    'male/south-asian-athletic-brown-buildL.png',
    'male/south-asian-muscular-fantasy-buildM.png',
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
