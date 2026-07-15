'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface TimePickerProps {
  onSelect: (totalSeconds: number) => void;
  initialSeconds?: number;
  initialMinutes?: number;
  initialHours?: number;
}

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 3;
const PADDING_ITEMS = Math.floor(VISIBLE_ITEMS / 2);

export function TimePicker({ onSelect, initialSeconds = 0, initialMinutes = 5, initialHours = 0 }: TimePickerProps) {
  const hours = Array.from({ length: 13 }, (_, i: number) => i); // 0..12
  const minutes = Array.from({ length: 60 }, (_, i: number) => i); // 0..59
  const seconds = Array.from({ length: 12 }, (_, i: number) => i * 5); // 0, 5, 10..55

  const [selectedHour, setSelectedHour] = useState(initialHours ?? 0);
  const [selectedMinute, setSelectedMinute] = useState(initialMinutes ?? 5);
  const [selectedSecond, setSelectedSecond] = useState(initialSeconds ?? 0);

  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  const secondRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const totalSeconds = ((selectedHour ?? 0) * 3600) + ((selectedMinute ?? 0) * 60) + (selectedSecond ?? 0);
    // Minimum 5 seconds to prevent zero-duration tasks
    const minSeconds = 5;
    const maxSeconds = 12 * 3600;
    onSelect?.(Math.max(minSeconds, Math.min(maxSeconds, totalSeconds)));
  }, [selectedHour, selectedMinute, selectedSecond, onSelect]);

  // Scroll to initial position
  useEffect(() => {
    const hIdx = hours.indexOf(initialHours ?? 0);
    const mIdx = minutes.indexOf(initialMinutes ?? 5);
    // Find closest seconds index
    const sVal = initialSeconds ?? 0;
    const sIdx = seconds.reduce((closest, val, idx) =>
      Math.abs(val - sVal) < Math.abs(seconds[closest] - sVal) ? idx : closest, 0);
    if (hourRef.current && hIdx >= 0) {
      hourRef.current.scrollTop = hIdx * ITEM_HEIGHT;
    }
    if (minuteRef.current && mIdx >= 0) {
      minuteRef.current.scrollTop = mIdx * ITEM_HEIGHT;
    }
    if (secondRef.current && sIdx >= 0) {
      secondRef.current.scrollTop = sIdx * ITEM_HEIGHT;
    }
  }, []);

  const handleScroll = useCallback((ref: React.RefObject<HTMLDivElement>, items: number[], setter: (v: number) => void) => {
    const el = ref?.current;
    if (!el) return;
    const scrollTop = el.scrollTop ?? 0;
    const idx = Math.round(scrollTop / ITEM_HEIGHT);
    const safeIdx = Math.max(0, Math.min((items?.length ?? 1) - 1, idx));
    setter(items?.[safeIdx] ?? 0);
  }, []);

  const renderColumn = (items: number[], selected: number, ref: React.RefObject<HTMLDivElement>, setter: (v: number) => void, label: string) => (
    <div className="flex flex-col items-center">
      <span className="text-xs text-muted-foreground mb-1 font-medium">{label}</span>
      <div className="relative" style={{ height: ITEM_HEIGHT * VISIBLE_ITEMS }}>
        {/* Selection highlight */}
        <div
          className="absolute left-0 right-0 bg-primary/15 rounded-lg pointer-events-none z-10"
          style={{ top: ITEM_HEIGHT * PADDING_ITEMS, height: ITEM_HEIGHT }}
        />
        <div
          ref={ref}
          className="scroll-picker overflow-y-auto h-full snap-y snap-mandatory w-14"
          style={{ scrollSnapType: 'y mandatory', touchAction: 'pan-y', overscrollBehavior: 'contain' }}
          onScroll={() => handleScroll(ref, items, setter)}
        >
          {/* Padding items */}
          <div style={{ height: ITEM_HEIGHT * PADDING_ITEMS }} />
          {(items ?? []).map((item: number, i: number) => (
            <div
              key={`${label}-${i}`}
              className={`flex items-center justify-center font-mono text-lg cursor-pointer snap-center transition-colors ${
                item === selected ? 'text-primary font-bold' : 'text-muted-foreground'
              }`}
              style={{ height: ITEM_HEIGHT }}
              onClick={() => {
                setter(item);
                const idx = (items ?? []).indexOf(item);
                ref?.current?.scrollTo({ top: idx * ITEM_HEIGHT, behavior: 'smooth' });
              }}
            >
              {String(item ?? 0).padStart(2, '0')}
            </div>
          ))}
          <div style={{ height: ITEM_HEIGHT * PADDING_ITEMS }} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-3">
      {renderColumn(hours, selectedHour, hourRef, setSelectedHour, 'Hours')}
      <span className="text-2xl font-mono text-muted-foreground mt-5">:</span>
      {renderColumn(minutes, selectedMinute, minuteRef, setSelectedMinute, 'Min')}
      <span className="text-2xl font-mono text-muted-foreground mt-5">:</span>
      {renderColumn(seconds, selectedSecond, secondRef, setSelectedSecond, 'Sec')}
    </div>
  );
}
