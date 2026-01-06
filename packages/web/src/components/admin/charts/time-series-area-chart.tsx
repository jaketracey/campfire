'use client';

import { useId, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

export type TimeSeriesAreaPoint = {
  label: string;
  value: number;
};

type Props = {
  data: TimeSeriesAreaPoint[];
  formatValue?: (value: number) => string;
  className?: string;
  colorClassName?: string;
};

export function TimeSeriesAreaChart({
  data,
  formatValue,
  className,
  colorClassName = 'text-campfire-500',
}: Props) {
  const gradientId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const width = 1000;
    const height = 120;
    const paddingTop = 10;
    const paddingBottom = 10;
    const drawableHeight = height - paddingTop - paddingBottom;

    if (!data || data.length === 0) {
      return { width, height, linePath: '', areaPath: '', points: [] as { x: number; y: number }[] };
    }

    const max = Math.max(...data.map((d) => d.value), 0.01);
    const min = Math.min(...data.map((d) => d.value), 0);
    const range = Math.max(max - min, 0.01);

    const xStep = data.length <= 1 ? 0 : width / (data.length - 1);
    const points = data.map((d, i) => {
      const x = i * xStep;
      const normalized = (d.value - min) / range;
      const y = paddingTop + (1 - normalized) * drawableHeight;
      return { x, y };
    });

    const linePath =
      points.length === 1
        ? `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.01} ${points[0].y}`
        : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    const areaPath = `M 0 ${height} ${linePath.slice(1)} L ${width} ${height} Z`;

    return { width, height, linePath, areaPath, points };
  }, [data]);

  const hovered = hoveredIndex == null ? null : data[hoveredIndex];
  const hoveredPoint = hoveredIndex == null ? null : geometry.points[hoveredIndex];

  return (
    <div className={cn('relative h-full w-full', className)}>
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className={cn('h-full w-full', colorClassName)}
        role="img"
        aria-label="Time series chart"
        preserveAspectRatio="none"
        onPointerLeave={() => setHoveredIndex(null)}
        onPointerMove={(event) => {
          if (!data || data.length === 0) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const x = ((event.clientX - rect.left) / rect.width) * geometry.width;
          const index =
            data.length <= 1 ? 0 : Math.min(data.length - 1, Math.max(0, Math.round(x / (geometry.width / (data.length - 1)))));
          setHoveredIndex(index);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path
          d={geometry.linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {hoveredPoint ? (
          <>
            <line
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={0}
              y2={geometry.height}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="6"
              fill="rgba(0,0,0,0.35)"
              stroke="currentColor"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>

      {hovered && hoveredPoint ? (
        <div
          className="absolute top-2 z-10 -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900/90 px-2 py-1 text-xs text-white shadow-lg backdrop-blur"
          style={{ left: `${(hoveredPoint.x / geometry.width) * 100}%` }}
        >
          <div className="text-gray-200">{hovered.label}</div>
          <div className="text-gray-400">
            {formatValue ? formatValue(hovered.value) : hovered.value}
          </div>
        </div>
      ) : null}
    </div>
  );
}

