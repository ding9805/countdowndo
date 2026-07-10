'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, Flame, CheckCircle2, Clock, Calendar } from 'lucide-react';
import { formatDuration } from '@/lib/timer-utils';
import { TASK_COLORS, getTaskColorHex } from '@/lib/types';

interface LogEntry {
  id: string;
  taskName: string;
  durationSeconds: number;
  color?: string;
  completedAt: string;
}

const STORAGE_KEY = 'countdowndo-completion-history';
const RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
];

function getDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatHours(seconds: number): string {
  const h = seconds / 3600;
  if (h < 0.1) return `${Math.round(seconds / 60)}m`;
  return `${h.toFixed(1)}h`;
}

export function Dashboard({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(14);

  const fetchData = useCallback(async () => {
    if (isLoggedIn) {
      try {
        const res = await fetch('/api/completion-log');
        if (res.ok) {
          const data = await res.json();
          setEntries(data);
        }
      } catch (e) {
        console.error('Dashboard fetch error:', e);
      }
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: LogEntry[] = JSON.parse(raw);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 60);
          cutoff.setHours(0, 0, 0, 0);
          setEntries(parsed.filter(e => new Date(e.completedAt) >= cutoff));
        }
      } catch {}
    }
    setLoading(false);
  }, [isLoggedIn]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('completion-log-updated', handler);
    return () => window.removeEventListener('completion-log-updated', handler);
  }, [fetchData]);

  // Metrics
  const totalTasks = entries.length;
  const totalSeconds = entries.reduce((s, e) => s + e.durationSeconds, 0);

  // Streak: count consecutive days with at least one task, ending today or yesterday
  const streak = useMemo(() => {
    if (entries.length === 0) return 0;
    const daysWithTasks = new Set<string>();
    for (const e of entries) {
      daysWithTasks.add(getDateKey(new Date(e.completedAt)));
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let check = new Date(today);
    // Start from today; if today has no tasks, start from yesterday
    if (!daysWithTasks.has(getDateKey(check))) {
      check.setDate(check.getDate() - 1);
      if (!daysWithTasks.has(getDateKey(check))) return 0;
    }
    let count = 0;
    while (daysWithTasks.has(getDateKey(check))) {
      count++;
      check.setDate(check.getDate() - 1);
    }
    return count;
  }, [entries]);

  // Histogram data: per-day, per-color
  const histogramData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: { dateKey: string; label: string; colors: Record<string, number> }[] = [];

    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = getDateKey(d);
      const label = i === 0 ? 'Today' : i === 1 ? 'Yest' : `${d.getMonth() + 1}/${d.getDate()}`;
      days.push({ dateKey, label, colors: {} });
    }

    // Fill in entry data
    for (const e of entries) {
      const dk = getDateKey(new Date(e.completedAt));
      const dayEntry = days.find(d => d.dateKey === dk);
      if (dayEntry) {
        const cid = e.color || 'orange';
        dayEntry.colors[cid] = (dayEntry.colors[cid] || 0) + e.durationSeconds;
      }
    }

    return days;
  }, [entries, rangeDays]);

  // Max seconds for scaling bars
  const maxSeconds = useMemo(() => {
    let max = 0;
    for (const d of histogramData) {
      const total = Object.values(d.colors).reduce((s, v) => s + v, 0);
      if (total > max) max = total;
    }
    return max || 1;
  }, [histogramData]);

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10 border border-primary/15">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <h2 className="font-semibold text-foreground text-base">Dashboard</h2>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <Flame className="w-5 h-5 mx-auto mb-1.5 text-orange-400" />
          <p className="text-lg font-bold text-foreground">{streak}</p>
          <p className="text-[10px] text-muted-foreground">day streak</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <CheckCircle2 className="w-5 h-5 mx-auto mb-1.5 text-green-400" />
          <p className="text-lg font-bold text-foreground">{totalTasks}</p>
          <p className="text-[10px] text-muted-foreground">tasks tracked</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Clock className="w-5 h-5 mx-auto mb-1.5 text-blue-400" />
          <p className="text-lg font-bold text-foreground">{formatHours(totalSeconds)}</p>
          <p className="text-[10px] text-muted-foreground">hours tracked</p>
        </div>
      </div>

      {/* Histogram */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Hours per day</span>
          </div>
          <div className="flex rounded-lg bg-secondary/30 p-0.5 border border-border/20">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => setRangeDays(opt.days)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                  rangeDays === opt.days
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Color legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-3">
          {TASK_COLORS.map(c => (
            <span key={c.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.hex }} />
              {c.label}
            </span>
          ))}
        </div>

        {/* Bars */}
        <div className="flex items-end gap-[2px]" style={{ height: 120 }}>
          {histogramData.map((day) => {
            const dayTotal = Object.values(day.colors).reduce((s, v) => s + v, 0);
            const barHeight = dayTotal > 0 ? Math.max(4, (dayTotal / maxSeconds) * 110) : 0;

            // Build stacked color segments
            const segments = TASK_COLORS
              .filter(c => day.colors[c.id])
              .map(c => ({
                colorId: c.id,
                hex: c.hex,
                fraction: day.colors[c.id] / dayTotal,
              }));

            return (
              <div key={day.dateKey} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                {/* Bar */}
                <div
                  className="w-full rounded-t-sm overflow-hidden flex flex-col-reverse transition-all"
                  style={{ height: barHeight }}
                  title={`${day.label}: ${formatHours(dayTotal)}`}
                >
                  {segments.map(seg => (
                    <div
                      key={seg.colorId}
                      style={{ backgroundColor: seg.hex, height: `${seg.fraction * 100}%` }}
                    />
                  ))}
                </div>
                {/* Label — show every nth depending on range */}
                {(rangeDays <= 14 || histogramData.indexOf(day) % Math.ceil(rangeDays / 14) === 0) && (
                  <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                    {day.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
