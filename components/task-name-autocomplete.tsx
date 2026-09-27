'use client';

import React, { useRef, useState } from 'react';
import { BankTask, Goal, PickedBankTask, Task } from '@/lib/types';
import { cursorTaskNameOffset, remainingIntervals } from '@/lib/goal-utils';
import { formatDuration } from '@/lib/timer-utils';
import { Input } from '@/components/ui/input';

interface TaskNameAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  onSelect: (picked: PickedBankTask[]) => void;
  onSelected?: () => void;
  tasks: Task[];
  isLoggedIn: boolean;
  placeholder: string;
  className?: string;
}

export function TaskNameAutocomplete({
  value,
  onChange,
  onEnter,
  onSelect,
  onSelected,
  tasks,
  isLoggedIn,
  placeholder,
  className,
}: TaskNameAutocompleteProps) {
  const [bankTasks, setBankTasks] = useState<BankTask[]>([]);
  const [bankGoals, setBankGoals] = useState<Goal[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchRequest = useRef(0);
  const listId = React.useId();
  const query = value.trim().toLocaleLowerCase();
  const suggestions = query && isLoggedIn
    ? bankTasks
        .filter((task) => task.name.toLocaleLowerCase().includes(query))
        .filter((task) => {
          const queuedCount = tasks.filter((queued) => queued.bankTaskId === task.id).length;
          const goal = bankGoals.find((item) => item.bankTaskId === task.id);
          if (goal) return queuedCount < remainingIntervals(goal);
          return !task.isOneOff || queuedCount === 0;
        })
        .sort((a, b) => {
          const aStarts = a.name.toLocaleLowerCase().startsWith(query);
          const bStarts = b.name.toLocaleLowerCase().startsWith(query);
          return Number(bStarts) - Number(aStarts) || a.name.localeCompare(b.name);
        })
        .slice(0, 8)
    : [];

  const loadBankSuggestions = async () => {
    if (!isLoggedIn) return;
    const request = ++searchRequest.current;
    try {
      const [tasksResponse, goalsResponse] = await Promise.all([
        fetch('/api/task-bank'),
        fetch('/api/goals'),
      ]);
      const [nextTasks, nextGoals] = await Promise.all([
        tasksResponse.ok ? tasksResponse.json() : [],
        goalsResponse.ok ? goalsResponse.json() : [],
      ]);
      if (request !== searchRequest.current) return;
      setBankTasks(nextTasks);
      setBankGoals(nextGoals);
    } catch {
      if (request !== searchRequest.current) return;
      setBankTasks([]);
      setBankGoals([]);
    }
  };

  const selectSuggestion = (task: BankTask) => {
    const goal = bankGoals.find((item) => item.bankTaskId === task.id);
    const alreadyQueued = tasks.filter((queued) => queued.bankTaskId === task.id).length;
    if (task.isOneOff && !goal && alreadyQueued > 0) return;
    if (goal && alreadyQueued >= remainingIntervals(goal)) return;
    onSelect([{ bankTask: task, name: goal ? cursorTaskNameOffset(goal, alreadyQueued) : undefined }]);
    onChange('');
    setActiveSuggestion(-1);
    setShowSuggestions(false);
    onSelected?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    } else if (showSuggestions && suggestions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActiveSuggestion((current) => event.key === 'ArrowDown'
        ? (current + 1) % suggestions.length
        : (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter') {
      if (showSuggestions && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        selectSuggestion(suggestions[activeSuggestion]);
      } else {
        onEnter?.();
      }
    }
  };

  return (
    <div onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setShowSuggestions(false);
    }}>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value.slice(0, 100));
          setActiveSuggestion(-1);
          setShowSuggestions(true);
        }}
        onFocus={() => { setShowSuggestions(true); loadBankSuggestions(); }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showSuggestions && suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={activeSuggestion >= 0 ? `${listId}-${activeSuggestion}` : undefined}
        maxLength={100}
        className={className}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div id={listId} role="listbox" aria-label="Matching Task Bank tasks" className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
          {suggestions.map((task, index) => (
            <button
              key={task.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeSuggestion === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(task)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-secondary/70 ${activeSuggestion === index ? 'bg-secondary/70' : ''}`}
            >
              <span className="min-w-0 truncate">{task.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(task.durationSeconds)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
