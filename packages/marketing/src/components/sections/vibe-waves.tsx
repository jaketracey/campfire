'use client';

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

function WavePoints() {
    const pointsRef = useRef<THREE.Points>(null);
    const count = 10000;

    const positions = useMemo(() => {
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 60; // wider x
            const y = (Math.random() - 0.5) * 30; // wider y
            const z = (Math.random() - 0.5) * 15; // wider z
            pos[i * 3] = x;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = z;
        }
        return pos;
    }, [count]);

    const colors = useMemo(() => {
        const cols = new Float32Array(count * 3);
        const palette = [
            new THREE.Color('#a855f7'), // neon
            new THREE.Color('#3b82f6'), // electric
            new THREE.Color('#ec4899'), // hot
            new THREE.Color('#06b6d4'), // cyan
        ];

        for (let i = 0; i < count; i++) {
            const color = palette[Math.floor(Math.random() * palette.length)];
            cols[i * 3] = color.r;
            cols[i * 3 + 1] = color.g;
            cols[i * 3 + 2] = color.b;
        }
        return cols;
    }, [count]);

    useFrame((state) => {
        if (!pointsRef.current) return;

        const time = state.clock.getElapsedTime();
        const pos = pointsRef.current.geometry.attributes.position.array as Float32Array;

        for (let i = 0; i < count; i++) {
            const x = pos[i * 3];
            const z = pos[i * 3 + 2];

            // Bigger waves: increased multipliers for displacement
            pos[i * 3 + 1] =
                Math.sin(x * 0.4 + time * 1.2) * 1.2 +
                Math.sin(z * 0.6 + time * 1.8) * 0.8 +
                Math.sin((x + z) * 0.2 + time) * 0.5;
        }

        pointsRef.current.geometry.attributes.position.needsUpdate = true;
        pointsRef.current.rotation.y = time * 0.03;
    });

    return (
        <Points ref={pointsRef} positions={positions} colors={colors}>
            <PointMaterial
                transparent
                vertexColors
                size={0.15}
                opacity={0.4}
                sizeAttenuation={true}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
            />
        </Points>
    );
}

export function VibeWaves() {
    return (
        <div className="fixed inset-0 z-0 bg-black">
            <Canvas camera={{ position: [0, 0, 10], fov: 75 }}>
                <color attach="background" args={['#000000']} />
                <ambientLight intensity={0.5} />
                <WavePoints />
            </Canvas>
            {/* Overlay gradient to blend with page */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black pointer-events-none" />
        </div>
    );
}
