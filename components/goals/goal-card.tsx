'use client';

import React, { useState } from 'react';
import { Goal, getTaskColorHex } from '@/lib/types';
import { Pencil, Trash2, CalendarDays, CheckCircle2, AlertTriangle, RefreshCw, Check, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { formatGoalValue, goalProgress, paceStatus, isGoalComplete, cursorTaskName } from '@/lib/goal-utils';
import { formatDueDate, isOverdue } from '@/lib/task-bank-utils';

interface GoalCardProps {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onDelete: (id: string) => void;
  onSetCurrentValue: (goal: Goal, value: number) => void;
  onRegenerate: (id: string) => void;
}

export function GoalCard({ goal, onEdit, onDelete, onSetCurrentValue, onRegenerate }: GoalCardProps) {
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressInput, setProgressInput] = useState('');

  const complete = isGoalComplete(goal);
  const progress = goalProgress(goal);
  const pace = complete ? null : paceStatus(goal);
  const orphaned = !complete && !goal.bankTaskId;

  const startProgressEdit = () => {
    setProgressInput(String(goal.currentValue));
    setEditingProgress(true);
  };

  const commitProgressEdit = () => {
    const value = parseFloat(progressInput);
    setEditingProgress(false);
    if (Number.isFinite(value) && value !== goal.currentValue) {
      onSetCurrentValue(goal, value);
    }
  };

  const paceBadge = pace && (
    <span
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
        pace.status === 'ahead'
          ? 'bg-green-500/15 text-green-600 dark:text-green-400'
          : pace.status === 'behind'
          ? 'bg-destructive/15 text-destructive'
          : 'bg-secondary/50 text-muted-foreground'
      }`}
    >
      {pace.status === 'on-pace'
        ? 'On pace'
        : `${pace.status === 'ahead' ? 'Ahead' : 'Behind'} by ${formatGoalValue(Math.abs(pace.delta))} ${goal.unit}`}
    </span>
  );

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`glass-card rounded-xl overflow-hidden px-4 py-3.5 ${complete ? 'opacity-70' : ''}`}
      style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `3px solid ${getTaskColorHex(goal.color)}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium break-words flex items-center gap-1.5">
            {complete && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
            {goal.name}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {editingProgress ? (
              <span className="inline-flex items-center gap-1">
                <Input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  value={progressInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProgressInput(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter') commitProgressEdit();
                    if (e.key === 'Escape') setEditingProgress(false);
                  }}
                  className="h-7 w-24 text-xs bg-secondary/60 border-border/50"
                />
                <button onClick={commitProgressEdit} className="p-1 rounded hover:bg-secondary/50 text-green-500">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingProgress(false)} className="p-1 rounded hover:bg-secondary/50 text-muted-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ) : (
              <button
                onClick={startProgressEdit}
                title="Click to update progress manually"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline decoration-dotted underline-offset-2"
              >
                {formatGoalValue(goal.currentValue)} / {formatGoalValue(goal.targetValue)} {goal.unit}
              </button>
            )}
            {paceBadge}
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                !complete && isOverdue(goal.dueDate) ? 'bg-destructive/15 text-destructive' : 'bg-secondary/50 text-muted-foreground'
              }`}
            >
              <CalendarDays className="w-3 h-3" />
              {formatDueDate(goal.dueDate)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEdit(goal)}
            className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(goal.id)}
            className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress * 100}%`, backgroundColor: getTaskColorHex(goal.color) }}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-muted-foreground">{formatGoalValue(goal.startValue)}</span>
          <span className="text-[11px] text-muted-foreground">{Math.round(progress * 100)}%</span>
          <span className="text-[11px] text-muted-foreground">{formatGoalValue(goal.targetValue)}</span>
        </div>
      </div>

      {!complete && !orphaned && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Next up in Task Bank: <span className="text-foreground/80">{cursorTaskName(goal)}</span>
        </p>
      )}

      {orphaned && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">Its task was removed from the Task Bank.</span>
          <button
            onClick={() => onRegenerate(goal.id)}
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            <RefreshCw className="w-3 h-3" />
            Regenerate
          </button>
        </div>
      )}
    </motion.div>
  );
}
