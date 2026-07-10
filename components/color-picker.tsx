'use client';

import React from 'react';
import { TASK_COLORS, TaskColorId } from '@/lib/types';

interface ColorPickerProps {
  value: TaskColorId;
  onChange: (color: TaskColorId) => void;
  size?: 'sm' | 'md';
}

export function ColorPicker({ value, onChange, size = 'md' }: ColorPickerProps) {
  const dotSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const ringSize = size === 'sm' ? 'ring-1 ring-offset-1' : 'ring-2 ring-offset-2';

  return (
    <div className="flex items-center gap-1.5">
      {TASK_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={`${dotSize} rounded-full transition-all flex-shrink-0 ${
            value === c.id
              ? `${ringSize} ring-white/70 ring-offset-background scale-110`
              : 'hover:scale-110 opacity-70 hover:opacity-100'
          }`}
          style={{ backgroundColor: c.hex }}
          title={c.label}
          aria-label={`Color: ${c.label}`}
        />
      ))}
    </div>
  );
}
