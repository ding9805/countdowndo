'use client';

import React, { useRef, useEffect, useCallback, useMemo } from 'react';

interface StartTimePickerProps {
  value: string | null; // "HH:MM" 24-hour format
  onChange: (value: string | null) => void;
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

  // The parent owns the selected time so a live "now" estimate can update
  // open wheels without the old wheel state overwriting it.
  const { hour12, minute, period } = parseValue(value);
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minutes = useMemo(() => {
    const steps = Array.from({ length: 12 }, (_, i) => i * 5);
    if (!steps.includes(minute)) steps.push(minute);
    return steps.sort((a, b) => a - b);
  }, [minute]);

  const selectTime = (hour: number, min: number, meridiem: 'AM' | 'PM') => {
    const hour24 = hour % 12 + (meridiem === 'PM' ? 12 : 0);
    const next = `${String(hour24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    if (next !== value) onChange(next);
  };
  const setHour12 = (hour: number) => selectTime(hour, minute, period);
  const setMinute = (min: number) => selectTime(hour12, min, period);
  const setPeriod = (meridiem: 'AM' | 'PM') => selectTime(hour12, minute, meridiem);
  const setToNow = () => onChange(null);

  useEffect(() => {
    if (hourRef.current) hourRef.current.scrollTop = hours.indexOf(hour12) * ITEM_HEIGHT;
    if (minuteRef.current) minuteRef.current.scrollTop = minutes.indexOf(minute) * ITEM_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hour12, minute, minutes]);

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
    <div className="flex flex-col items-center gap-2">
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
      <button
        type="button"
        onClick={setToNow}
        className="px-3 py-1 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
      >
        Time now
      </button>
    </div>
  );
}
