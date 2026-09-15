'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface StartTimePickerProps {
  value: string | null; // "HH:MM" 24-hour format
  onChange: (value: string) => void;
}

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;

export function StartTimePicker({ value, onChange }: StartTimePickerProps) {
  // Parse initial value
  // Keeps the exact minute: the planning start defaults to "now", and snapping
  // it to a 5-minute step on mount would silently shift every projected end
  // time by up to 2.5 minutes before the user touched anything.
  const parseValue = (val: string | null) => {
    if (!val) {
      const now = new Date();
      return {
        hour12: now.getHours() % 12 || 12,
        minute: now.getMinutes(),
        period: now.getHours() >= 12 ? 'PM' as const : 'AM' as const,
      };
    }
    const [h, m] = val.split(':').map(Number);
    return {
      hour12: (h % 12) || 12,
      minute: Math.max(0, Math.min(59, m || 0)),
      period: (h >= 12 ? 'PM' : 'AM') as 'AM' | 'PM',
    };
  };

  const initial = parseValue(value);
  const [hour12, setHour12] = useState(initial.hour12);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState<'AM' | 'PM'>(initial.period);

  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);

  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  // 5-minute steps, plus the initial minute when it's off-grid so the wheel
  // can show (and keep) the exact current time until the user scrolls away.
  const minutes = useMemo(() => {
    const steps = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10...55
    if (!steps.includes(initial.minute)) steps.push(initial.minute);
    return steps.sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit onChange — only when the wheel state differs from the prop, so
  // mounting doesn't re-emit (or rewrite) the value it was given.
  useEffect(() => {
    let h24 = hour12 % 12;
    if (period === 'PM') h24 += 12;
    const hStr = String(h24).padStart(2, '0');
    const mStr = String(minute).padStart(2, '0');
    const next = `${hStr}:${mStr}`;
    if (next !== value) onChange(next);
  }, [hour12, minute, period, onChange, value]);

  // Scroll to initial position
  useEffect(() => {
    const hIdx = hours.indexOf(initial.hour12);
    const mIdx = minutes.indexOf(initial.minute);
    if (hourRef.current && hIdx >= 0) {
      hourRef.current.scrollTop = hIdx * ITEM_HEIGHT;
    }
    if (minuteRef.current && mIdx >= 0) {
      minuteRef.current.scrollTop = mIdx * ITEM_HEIGHT;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = useCallback(
    (ref: React.RefObject<HTMLDivElement>, items: number[], setter: (v: number) => void) => {
      const el = ref?.current;
      if (!el) return;
      const scrollTop = el.scrollTop ?? 0;
      const idx = Math.round(scrollTop / ITEM_HEIGHT);
      const safeIdx = Math.max(0, Math.min((items?.length ?? 1) - 1, idx));
      setter(items?.[safeIdx] ?? 0);
    },
    []
  );

  const renderColumn = (
    items: number[],
    selected: number,
    ref: React.RefObject<HTMLDivElement>,
    setter: (v: number) => void
  ) => (
    <div className="relative" style={{ height: ITEM_HEIGHT * VISIBLE_ITEMS, width: 48 }}>
      {/* Selection highlight */}
      <div
        className="absolute left-0 right-0 bg-primary/15 rounded-lg pointer-events-none z-10"
        style={{ top: ITEM_HEIGHT * 2, height: ITEM_HEIGHT }}
      />
      <div
        ref={ref}
        className="scroll-picker overflow-y-auto h-full snap-y snap-mandatory"
        style={{ scrollSnapType: 'y mandatory' }}
        onScroll={() => handleScroll(ref, items, setter)}
      >
        <div style={{ height: ITEM_HEIGHT * 2 }} />
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex items-center justify-center font-mono text-base cursor-pointer snap-center transition-all ${
              item === selected ? 'text-primary font-bold scale-105' : 'text-muted-foreground'
            }`}
            style={{ height: ITEM_HEIGHT }}
            onClick={() => {
              setter(item);
              const idx = items.indexOf(item);
              ref?.current?.scrollTo({ top: idx * ITEM_HEIGHT, behavior: 'smooth' });
            }}
          >
            {String(item).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: ITEM_HEIGHT * 2 }} />
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      {renderColumn(hours, hour12, hourRef, setHour12)}
      <span className="text-xl font-mono text-muted-foreground">:</span>
      {renderColumn(minutes, minute, minuteRef, setMinute)}
      {/* AM/PM toggle */}
      <div className="flex flex-col gap-1 ml-1">
        <button
          onClick={() => setPeriod('AM')}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            period === 'AM'
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
          }`}
        >
          AM
        </button>
        <button
          onClick={() => setPeriod('PM')}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            period === 'PM'
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
          }`}
        >
          PM
        </button>
      </div>
    </div>
  );
}
