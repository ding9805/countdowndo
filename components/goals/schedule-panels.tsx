'use client';

import React, { useMemo, useState } from 'react';
import { Goal, getTaskColorHex } from '@/lib/types';
import {
  addDays,
  daysBetween,
  goalLeadDays,
  isGoalComplete,
  overallLeadDays,
  paceStatus,
  todayLocalDateString,
} from '@/lib/goal-utils';
import { formatDueDate } from '@/lib/task-bank-utils';
import { PaceBadge } from './goal-card';
import { Clock, FastForward, RotateCcw } from 'lucide-react';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "5 days ahead" / "3 days behind" / "Clear to the due date".
export function formatLead(days: number): string {
  if (days === Infinity) return 'Clear to the due date';
  if (days < 0) return `${plural(-days, 'day')} behind`;
  return `${plural(days, 'day')} ahead`;
}

function leadTone(days: number): string {
  if (days < 0) return 'text-destructive';
  if (days === 0) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

function PanelShell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="glass-card rounded-xl px-4 py-3.5 min-w-0" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function GoalRow({ goal, children }: { goal: Goal; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 min-w-0 text-xs">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getTaskColorHex(goal.color) }} />
      <span className="truncate flex-1 text-foreground/90">{goal.name}</span>
      {children}
    </li>
  );
}

// The overall estimate of time ahead or behind, in days, across active goals.
export function ScheduleOverviewPanel({ goals, today }: { goals: Goal[]; today: Date }) {
  const active = goals.filter((g) => !isGoalComplete(g));
  const overall = overallLeadDays(active, today);
  const behind = active.filter((g) => goalLeadDays(g, today) < 0).length;

  return (
    <PanelShell icon={<Clock className="w-3.5 h-3.5" />} title="Overall schedule">
      {!overall ? (
        <p className="text-sm text-muted-foreground">No active goals to track.</p>
      ) : (
        <>
          <p className={`font-display text-2xl font-bold ${leadTone(overall.days)}`}>{formatLead(overall.days)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {overall.days < 0
              ? `${plural(behind, 'goal')} behind schedule. Furthest behind: ${overall.goal.name}.`
              : overall.days === Infinity
              ? 'Every active goal is already done up to its due date.'
              : `Every goal stays on track for that long. ${overall.goal.name} falls behind first.`}
          </p>
          <ul className="mt-3 space-y-1.5">
            {active.map((g) => {
              const lead = goalLeadDays(g, today);
              return (
                <GoalRow key={g.id} goal={g}>
                  <span className={`shrink-0 font-medium ${leadTone(lead)}`}>{formatLead(lead)}</span>
                </GoalRow>
              );
            })}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

// Step or pick a date ahead of today and see which goals would still be on
// track then if nothing more got done.
export function DateFastForwarder({ goals, today }: { goals: Goal[]; today: Date }) {
  const [offset, setOffset] = useState(0);
  const active = useMemo(() => goals.filter((g) => !isGoalComplete(g)), [goals]);
  const date = addDays(today, offset);
  const overall = overallLeadDays(active, today);
  const behindThen = active.filter((g) => paceStatus(g, date).status === 'behind').length;
  const step = (days: number) => setOffset((o) => Math.max(0, o + days));

  const pickDate = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return;
    setOffset(Math.max(0, daysBetween(today, new Date(y, m - 1, d))));
  };

  const stepButton = 'px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary/50 hover:bg-secondary text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-secondary/50';

  return (
    <PanelShell icon={<FastForward className="w-3.5 h-3.5" />} title="Fast-forward">
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active goals to track.</p>
      ) : (
        <>
          <p className={`font-display text-2xl font-bold ${behindThen ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
            {behindThen ? `${plural(behindThen, 'goal')} behind` : 'All on track'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {offset === 0 ? 'Today' : `${formatDueDate(todayLocalDateString(date), today)}, in ${plural(offset, 'day')}`}, if nothing more gets done.
            {overall && overall.days !== Infinity && overall.days > 0 && ` You can skip ${plural(overall.days, 'day')} and stay on schedule.`}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            <button className={stepButton} onClick={() => step(-1)} disabled={offset === 0} aria-label="Back one day">−1d</button>
            <button className={stepButton} onClick={() => step(1)} aria-label="Forward one day">+1d</button>
            <button className={stepButton} onClick={() => step(7)} aria-label="Forward one week">+1w</button>
            <input
              type="date"
              aria-label="Fast-forward to date"
              min={todayLocalDateString(today)}
              value={todayLocalDateString(date)}
              onChange={(e) => pickDate(e.target.value)}
              className="h-7 px-2 rounded-lg text-xs bg-secondary/60 border border-border/50 text-foreground"
            />
            {offset > 0 && (
              <button className={stepButton} onClick={() => setOffset(0)} aria-label="Back to today">
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
          <ul className="mt-3 space-y-1.5">
            {active.map((g) => (
              <GoalRow key={g.id} goal={g}>
                <PaceBadge pace={paceStatus(g, date)} unit={g.unit} />
              </GoalRow>
            ))}
          </ul>
        </>
      )}
    </PanelShell>
  );
}
