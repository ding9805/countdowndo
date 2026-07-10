'use client';

import React from 'react';

interface CircularProgressProps {
  progress: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  isOvertime?: boolean;
  isDone?: boolean;
}

export function CircularProgress({
  progress = 0,
  size = 160,
  strokeWidth = 6,
  isOvertime = false,
  isDone = false,
}: CircularProgressProps) {
  const safeProgress = Math.max(0, Math.min(1, progress ?? 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safeProgress);

  const strokeColor = isDone
    ? 'hsl(142, 71%, 45%)'
    : isOvertime
    ? 'hsl(0, 72%, 55%)'
    : 'hsl(32, 95%, 55%)';

  const trackColor = isDone
    ? 'hsl(142, 71%, 45%, 0.12)'
    : isOvertime
    ? 'hsl(0, 72%, 55%, 0.12)'
    : 'hsl(32, 95%, 55%, 0.1)';

  return (
    <svg width={size} height={size} className="-rotate-90">
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      {/* Progress */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  );
}
