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
  const [duration, setDuration] = useState(() =>
    Math.max(5, Math.min(12 * 3600, initialHours * 3600 + initialMinutes * 60 + initialSeconds))
  );
  const selectedHour = Math.floor(duration / 3600);
  const selectedMinute = Math.floor((duration % 3600) / 60);
  const selectedSecond = duration % 60;
  const hours = Array.from({ length: 13 }, (_, i) => i);
  // At the maximum duration, minutes and seconds must both be zero.
  const minutes = selectedHour === 12 ? [0] : Array.from({ length: 60 }, (_, i) => i);
  const seconds = selectedHour === 12 ? [0] : Array.from({ length: 12 }, (_, i) => i * 5)
    .filter(second => selectedHour > 0 || selectedMinute > 0 || second > 0);
  // Preserve exact durations from saved tasks, even between five-second steps.
  if (!seconds.includes(selectedSecond)) seconds.push(selectedSecond);
  seconds.sort((a, b) => a - b);

  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  const secondRef = useRef<HTMLDivElement>(null);

  const selectDuration = (hour: number, minute: number, second: number) => {
    setDuration(Math.max(5, Math.min(12 * 3600, hour * 3600 + minute * 60 + second)));
  };
  const setSelectedHour = (hour: number) => selectDuration(hour, selectedMinute, selectedSecond);
  const setSelectedMinute = (minute: number) => selectDuration(selectedHour, minute, selectedSecond);
  const setSelectedSecond = (second: number) => selectDuration(selectedHour, selectedMinute, second);

  useEffect(() => {
    onSelect(duration);
  }, [duration, onSelect]);

  // Keep all wheels aligned with the actual duration, including when a limit
  // corrects another column (12 hours clears minutes and seconds).
  useEffect(() => {
    if (hourRef.current) hourRef.current.scrollTop = selectedHour * ITEM_HEIGHT;
    if (minuteRef.current) minuteRef.current.scrollTop = selectedMinute * ITEM_HEIGHT;
    if (secondRef.current) secondRef.current.scrollTop = seconds.indexOf(selectedSecond) * ITEM_HEIGHT;
    // The options are derived from duration, so it also covers list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

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
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        {renderColumn(hours, selectedHour, hourRef, setSelectedHour, 'Hours')}
        <span className="text-2xl font-mono text-muted-foreground mt-5">:</span>
        {renderColumn(minutes, selectedMinute, minuteRef, setSelectedMinute, 'Min')}
        <span className="text-2xl font-mono text-muted-foreground mt-5">:</span>
        {renderColumn(seconds, selectedSecond, secondRef, setSelectedSecond, 'Sec')}
      </div>
      <p className="text-xs text-muted-foreground">5 seconds minimum · 12 hours maximum</p>
    </div>
  );
}
