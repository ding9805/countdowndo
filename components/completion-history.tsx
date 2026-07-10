'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { History, Clock, CheckCircle2, X, ChevronDown, ChevronUp, ChevronsUpDown, Minimize2 } from 'lucide-react';
import { formatDuration } from '@/lib/timer-utils';
import { TASK_COLORS, getTaskColorHex } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';

interface CompletionEntry {
  id: string;
  taskName: string;
  durationSeconds: number;
  color?: string;
  completedAt: string;
}

interface ColorBreakdown {
  colorId: string;
  hex: string;
  label: string;
  totalSeconds: number;
  count: number;
}

interface DayGroup {
  label: string;
  dateKey: string;
  entries: CompletionEntry[];
  totalSeconds: number;
  colorBreakdowns: ColorBreakdown[];
}

const STORAGE_KEY = 'countdowndo-completion-history';

function computeColorBreakdowns(entries: CompletionEntry[]): ColorBreakdown[] {
  const map: Record<string, { totalSeconds: number; count: number }> = {};
  for (const entry of entries) {
    const cid = entry.color || 'orange';
    if (!map[cid]) map[cid] = { totalSeconds: 0, count: 0 };
    map[cid].totalSeconds += entry.durationSeconds;
    map[cid].count += 1;
  }

  return TASK_COLORS
    .filter(c => map[c.id])
    .map(c => ({
      colorId: c.id,
      hex: c.hex,
      label: c.label,
      totalSeconds: map[c.id].totalSeconds,
      count: map[c.id].count,
    }));
}

function groupByDay(entries: CompletionEntry[]): DayGroup[] {
  const groups: Record<string, CompletionEntry[]> = {};

  for (const entry of entries) {
    const d = new Date(entry.completedAt);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(entry);
  }

  const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  return sortedKeys.map(dateKey => {
    let label: string;
    if (dateKey === todayKey) {
      label = 'Today';
    } else if (dateKey === yesterdayKey) {
      label = 'Yesterday';
    } else {
      const [y, m, d] = dateKey.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }

    const dayEntries = groups[dateKey].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );

    const totalSeconds = dayEntries.reduce((sum, e) => sum + e.durationSeconds, 0);
    const colorBreakdowns = computeColorBreakdowns(dayEntries);

    return { label, dateKey, entries: dayEntries, totalSeconds, colorBreakdowns };
  });
}

function formatTimeOfDay(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function CompletionHistory({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [entries, setEntries] = useState<CompletionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const fetchHistory = useCallback(async () => {
    if (isLoggedIn) {
      try {
        const res = await fetch('/api/completion-log');
        if (res.ok) {
          const data = await res.json();
          setEntries(data);
        }
      } catch (e) {
        console.error('Failed to fetch completion history:', e);
      }
    } else {
      // Guest mode: load from localStorage
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: CompletionEntry[] = JSON.parse(raw);
          // Filter to last 60 days
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 60);
          cutoff.setHours(0, 0, 0, 0);
          setEntries(parsed.filter(e => new Date(e.completedAt) >= cutoff));
        }
      } catch {}
    }
    setLoading(false);
  }, [isLoggedIn]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Listen for custom event to refresh history
  useEffect(() => {
    const handler = () => fetchHistory();
    window.addEventListener('completion-log-updated', handler);
    return () => window.removeEventListener('completion-log-updated', handler);
  }, [fetchHistory]);

  const handleDelete = async (id: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    if (isLoggedIn) {
      try {
        const res = await fetch('/api/completion-log', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (res.ok) {
          setEntries(prev => prev.filter(e => e.id !== id));
        }
      } catch (e) {
        console.error('Failed to delete completion entry:', e);
      }
    } else {
      try {
        const updated = entries.filter(e => e.id !== id);
        setEntries(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    }
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleDay = (dateKey: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const dayGroups = groupByDay(entries);
  const totalCompleted = entries.length;
  const totalTime = entries.reduce((sum, e) => sum + e.durationSeconds, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-xl bg-primary/10 border border-primary/15">
          <History className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground text-base">Completion History</h2>
          <p className="text-xs text-muted-foreground">
            {totalCompleted} task{totalCompleted !== 1 ? 's' : ''} completed
            {totalTime > 0 && ` · ${formatDuration(totalTime)} total`}
          </p>
        </div>
      </div>

      {/* 60-day note */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-secondary/20 border border-border/30">
        <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          History is recorded for the past 60 days. Older entries are automatically removed.
        </p>
      </div>

      {!loading && dayGroups.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setCollapsedDays(new Set())}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            title="Expand all days"
          >
            <ChevronsUpDown className="w-3 h-3" />
            Expand all
          </button>
          <button
            onClick={() => setCollapsedDays(new Set(dayGroups.map(g => g.dateKey)))}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            title="Collapse all days"
          >
            <Minimize2 className="w-3 h-3" />
            Collapse all
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
      ) : dayGroups.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No completed tasks yet.</p>
          <p className="text-muted-foreground/60 text-xs mt-1">Completed tasks will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {dayGroups.map(group => {
            const isCollapsed = collapsedDays.has(group.dateKey);
            return (
              <div key={group.dateKey} className="glass-card rounded-xl overflow-hidden">
                {/* Day header */}
                <button
                  onClick={() => toggleDay(group.dateKey)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm text-foreground">{group.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {group.entries.length} task{group.entries.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-primary font-medium">
                      {formatDuration(group.totalSeconds)}
                    </span>
                    {isCollapsed ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Color breakdown bar + per-color hours */}
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Color breakdown */}
                      {group.colorBreakdowns.length > 1 && (
                        <div className="px-4 py-2 border-b border-border/20">
                          {/* Stacked bar */}
                          <div className="flex h-1.5 rounded-full overflow-hidden mb-1.5">
                            {group.colorBreakdowns.map(cb => (
                              <div
                                key={cb.colorId}
                                className="h-full"
                                style={{
                                  backgroundColor: cb.hex,
                                  width: `${(cb.totalSeconds / group.totalSeconds) * 100}%`,
                                }}
                              />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {group.colorBreakdowns.map(cb => (
                              <span key={cb.colorId} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cb.hex }} />
                                {formatDuration(cb.totalSeconds)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Task entries */}
                      <div className="divide-y divide-border/30">
                        {group.entries.map(entry => (
                          <div
                            key={entry.id}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/10 transition-colors"
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: getTaskColorHex(entry.color) }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground truncate">{entry.taskName}</p>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {formatDuration(entry.durationSeconds)}
                              </span>
                              <span className="text-xs text-muted-foreground/60">
                                {formatTimeOfDay(entry.completedAt)}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                disabled={deletingIds.has(entry.id)}
                                className="p-1 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                                title="Remove from history"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
