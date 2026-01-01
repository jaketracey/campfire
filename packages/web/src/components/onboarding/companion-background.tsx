'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

const COMPANIONS = [
    'black-athletic-black.png', 'black-curvy-brown.png', 'black-plus-size-red.png',
    'caucasian-athletic-blonde.png', 'caucasian-curvy-black.png', 'caucasian-plus-size-brown.png',
    'east-asian-athletic-red.png', 'east-asian-curvy-black.png', 'east-asian-slim-blonde.png',
    'latina-athletic-brown.png', 'latina-curvy-red.png', 'latina-plus-size-black.png',
    'south-asian-athletic-blonde.png', 'south-asian-curvy-red.png', 'south-asian-plus-size-fantasy.png',
    'black-slim-brown.png', 'caucasian-slim-red.png'
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
                    {/* Create enough clones for seamless loop */}
                    {[...COMPANIONS, ...COMPANIONS, ...COMPANIONS, ...COMPANIONS].map((img, i) => (
                        <div key={i} className="w-56 h-80 md:w-72 md:h-[420px] relative flex-shrink-0 grayscale">
                            <img
                                src={`/images/companions/${img}`}
                                alt=""
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
