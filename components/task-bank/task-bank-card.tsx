'use client';

import React from 'react';
import { BankTask, getTaskColorHex } from '@/lib/types';
import { formatDuration } from '@/lib/timer-utils';
import { Pencil, Trash2, CalendarDays, Zap } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { motion } from 'framer-motion';
import { isOverdue, formatDueDate, dueDayDiff } from '@/lib/task-bank-utils';

interface TaskBankCardProps {
  task: BankTask;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEdit?: (task: BankTask) => void;
  onDelete?: (id: string) => void;
}

export function TaskBankCard({ task, selectable, selected, onToggleSelect, onEdit, onDelete }: TaskBankCardProps) {
  const dueToday = !!task.dueDate && dueDayDiff(task.dueDate) === 0;
  const content = (
    <>
      {selectable && (
        <Checkbox
          checked={!!selected}
          onCheckedChange={() => onToggleSelect?.(task.id)}
          className="shrink-0"
        />
      )}
      <div className="flex-1 min-w-0" onClick={selectable ? () => onToggleSelect?.(task.id) : undefined}>
        <p className="text-foreground font-medium break-words">{task.name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">{formatDuration(task.durationSeconds)}</span>
          {task.isOneOff && (
            <span
              title="One-off task — deleted from bank when completed or removed from session"
              className="text-[11px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-400"
            >
              <Zap className="w-3 h-3" />
              One-off
            </span>
          )}
          {task.dueDate && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
              isOverdue(task.dueDate) ? 'bg-destructive/15 text-destructive' : 'bg-secondary/50 text-muted-foreground'
            }`}>
              <CalendarDays className="w-3 h-3" />
              {formatDueDate(task.dueDate)}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-secondary/50 text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(task); }}
              className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
              className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`glass-card rounded-xl overflow-hidden flex items-center gap-3 px-4 py-3 transition-all ${
        selectable ? 'cursor-pointer' : ''
      } ${selected ? 'ring-2 ring-primary/60' : ''} ${dueToday ? 'border-2 border-red-500' : ''}`}
      style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `3px solid ${getTaskColorHex(task.color)}` }}
    >
      {content}
    </motion.div>
  );
}
