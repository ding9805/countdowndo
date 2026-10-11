'use client';

import { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getDurationPresets, formatPresetDuration } from '@/lib/duration-presets';
import { TimePicker } from './time-picker';

export function DurationSelector({ value, onChange, isLoggedIn, resetKey }: {
  value: number;
  onChange: (seconds: number) => void;
  isLoggedIn: boolean;
  resetKey: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [presets, setPresets] = useState(() => getDurationPresets([]));
  const pickerId = useId();

  useEffect(() => setExpanded(false), [resetKey]);

  useEffect(() => {
    setPresets(getDurationPresets([]));
    if (!isLoggedIn) return;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch('/api/task-bank', { signal: request.signal });
        const tasks = response.ok ? await response.json() : [];
        if (!request.signal.aborted) setPresets(getDurationPresets(Array.isArray(tasks) ? tasks : []));
      } catch {
        if (!request.signal.aborted) setPresets(getDurationPresets([]));
      }
    };
    refresh();
    window.addEventListener('bank-tasks-updated', refresh);
    return () => {
      controller?.abort();
      window.removeEventListener('bank-tasks-updated', refresh);
    };
  }, [isLoggedIn]);

  return (
    <div className="rounded-xl border border-border/30 bg-secondary/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Duration</span>
        <span className="text-primary font-semibold tabular-nums">{formatPresetDuration(value)}</span>
      </div>
      <div role="group" aria-label="Duration presets" className="flex gap-2 overflow-x-auto overscroll-x-contain pb-2">
        {presets.map((seconds) => (
          <button
            key={seconds}
            type="button"
            aria-pressed={value === seconds}
            onClick={() => { setExpanded(false); onChange(seconds); }}
            className={`min-h-11 min-w-11 shrink-0 rounded-full px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              value === seconds ? 'bg-primary text-primary-foreground' : 'bg-secondary/70 text-foreground hover:bg-primary/15'
            }`}
          >
            {formatPresetDuration(seconds)}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={pickerId}
        onClick={() => setExpanded(!expanded)}
        className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-sm text-muted-foreground hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Custom duration
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      <div id={pickerId} hidden={!expanded}>
        {expanded && (
          <div className="flex justify-center">
            <TimePicker
              onSelect={onChange}
              initialHours={Math.floor(value / 3600)}
              initialMinutes={Math.floor((value % 3600) / 60)}
              initialSeconds={value % 60}
            />
          </div>
        )}
      </div>
    </div>
  );
}
