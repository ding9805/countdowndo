'use client';

import { GanttChart, LayoutGrid } from 'lucide-react';

export type SessionView = 'cards' | 'timeline';

interface SessionViewToggleProps {
  value: SessionView;
  onChange: (value: SessionView) => void;
}

export function SessionViewToggle({ value, onChange }: SessionViewToggleProps) {
  return (
    <div className="inline-flex items-center rounded-xl bg-secondary/30 p-1 border border-border/40 gap-0.5">
      <button
        type="button"
        onClick={() => onChange('cards')}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
          value === 'cards'
            ? 'bg-primary/15 text-primary shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
        }`}
        aria-pressed={value === 'cards'}
        title="Card view"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span>Cards</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('timeline')}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
          value === 'timeline'
            ? 'bg-primary/15 text-primary shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
        }`}
        aria-pressed={value === 'timeline'}
        title="Timeline view"
      >
        <GanttChart className="w-3.5 h-3.5" />
        <span>Timeline</span>
      </button>
    </div>
  );
}
