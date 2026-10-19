'use client';

import React, { useState, useEffect } from 'react';
import { Goal, TaskColorId } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/color-picker';
import { TimePicker } from '@/components/time-picker';
import { TagInput, mergePendingTag } from '@/components/task-bank/tag-input';
import { formatDuration } from '@/lib/timer-utils';
import { formatGoalValue, wholeIntervalSuggestions, todayLocalDateString } from '@/lib/goal-utils';

export interface GoalFormData {
  name: string;
  unit: string;
  startValue: number;
  targetValue: number;
  intervals: number;
  intervalSeconds: number;
  color: TaskColorId;
  tags: string[];
  startDate: string;
  dueDate: string;
}

interface GoalFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 'duplicate' creates a new goal, prefilled from initialGoal as a template.
  mode: 'create' | 'edit' | 'duplicate';
  initialGoal?: Goal | null;
  existingTags: string[];
  onSubmit: (data: GoalFormData) => Promise<void> | void;
}

const DEFAULTS = {
  name: '', unit: '', startValue: '0', targetValue: '', intervals: '1',
  intervalSeconds: 1500, color: 'orange' as TaskColorId, dueDate: '',
};

export function GoalForm({ open, onOpenChange, mode, initialGoal, existingTags, onSubmit }: GoalFormProps) {
  const [name, setName] = useState(DEFAULTS.name);
  const [unit, setUnit] = useState(DEFAULTS.unit);
  const [startValue, setStartValue] = useState(DEFAULTS.startValue);
  const [targetValue, setTargetValue] = useState(DEFAULTS.targetValue);
  const [intervals, setIntervals] = useState(DEFAULTS.intervals);
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULTS.intervalSeconds);
  const [color, setColor] = useState<TaskColorId>(DEFAULTS.color);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [startDate, setStartDate] = useState(() => todayLocalDateString());
  const [dueDate, setDueDate] = useState(DEFAULTS.dueDate);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode !== 'create' && initialGoal) {
      setName(initialGoal.name);
      setUnit(initialGoal.unit);
      setStartValue(String(initialGoal.startValue));
      setTargetValue(String(initialGoal.targetValue));
      setIntervals(String(initialGoal.intervals));
      setIntervalSeconds(initialGoal.intervalSeconds);
      setColor(initialGoal.color);
      setTags(initialGoal.tags);
      setStartDate(mode === 'edit' ? initialGoal.startDate : todayLocalDateString());
      setDueDate(initialGoal.dueDate);
    } else {
      setName(DEFAULTS.name);
      setUnit(DEFAULTS.unit);
      setStartValue(DEFAULTS.startValue);
      setTargetValue(DEFAULTS.targetValue);
      setIntervals(DEFAULTS.intervals);
      setIntervalSeconds(DEFAULTS.intervalSeconds);
      setColor(DEFAULTS.color);
      setTags([]);
      setStartDate(todayLocalDateString());
      setDueDate(DEFAULTS.dueDate);
    }
    setTagInput('');
    setShowTimePicker(false);
    setShowErrors(false);
  }, [open, mode, initialGoal]);

  const start = parseFloat(startValue);
  const target = parseFloat(targetValue);
  const nIntervals = parseInt(intervals, 10);
  const validNumbers =
    Number.isFinite(start) && Number.isFinite(target) && target > start &&
    Number.isInteger(nIntervals) && nIntervals >= 1;
  const chunkSize = validNumbers ? (target - start) / nIntervals : null;
  // Interval counts that would give whole-number chunks, offered as one-tap
  // fixes when the current count doesn't divide the range evenly.
  const wholeSuggestions = validNumbers
    ? wholeIntervalSuggestions(start, target, nIntervals)
    : [];
  const isValid = !!name.trim() && !!unit.trim() && !!startDate && !!dueDate && startDate <= dueDate && validNumbers;
  const canSubmit = isValid && !submitting;

  // Which required fields are empty/invalid. Only surfaced once the user tries
  // to submit — a fresh form shouldn't open covered in red.
  const errors = {
    name: !name.trim(),
    unit: !unit.trim(),
    numbers: !validNumbers,
    startDate: !startDate,
    dueDate: !dueDate || (!!startDate && startDate > dueDate),
  };
  const err = (on: boolean) =>
    showErrors && on ? 'border-destructive ring-1 ring-destructive/40' : '';

  const handleSubmit = async () => {
    if (!isValid) {
      setShowErrors(true);
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Flush any tag text typed but not yet committed with Enter/comma.
      const finalTags = mergePendingTag(tags, tagInput);
      await onSubmit({
        name: name.trim(),
        unit: unit.trim(),
        startValue: start,
        targetValue: target,
        intervals: nIntervals,
        intervalSeconds,
        color,
        tags: finalTags,
        startDate,
        dueDate,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New Goal' : mode === 'duplicate' ? 'Duplicate Goal' : 'Edit Goal'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Goal name</label>
            <Input
              autoFocus
              placeholder="e.g., Read Atomic Habits"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value.slice(0, 100))}
              maxLength={100}
              className={`bg-secondary/60 border-border/50 ${err(errors.name)}`}
            />
            {showErrors && errors.name && (
              <p className="text-[11px] text-destructive mt-1.5">Give your goal a name.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Start at</label>
              <Input
                type="number"
                inputMode="decimal"
                value={startValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartValue(e.target.value)}
                className={`bg-secondary/60 border-border/50 ${err(errors.numbers)}`}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Target</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="100"
                value={targetValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTargetValue(e.target.value)}
                className={`bg-secondary/60 border-border/50 ${err(errors.numbers)}`}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Unit</label>
              <Input
                placeholder="pages"
                value={unit}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUnit(e.target.value.slice(0, 30))}
                maxLength={30}
                className={`bg-secondary/60 border-border/50 ${err(errors.unit)}`}
              />
            </div>
          </div>
          {showErrors && (errors.numbers || errors.unit) && (
            <p className="text-[11px] text-destructive -mt-2">
              {errors.numbers
                ? 'Target must be a number greater than Start.'
                : 'Set a unit (e.g. pages, trades).'}
            </p>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Intervals (sessions to finish)</label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={intervals}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIntervals(e.target.value)}
              className={`bg-secondary/60 border-border/50 ${err(errors.numbers)}`}
            />
            {chunkSize !== null && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Each session covers {Number.isInteger(chunkSize) ? '' : '~'}
                {formatGoalValue(chunkSize)} {unit.trim() || 'units'}.
              </p>
            )}
            {wholeSuggestions.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                For whole {unit.trim() || 'units'} per session, try{' '}
                {wholeSuggestions.map((n, i) => (
                  <span key={n}>
                    {i > 0 ? ' · ' : ''}
                    <button
                      type="button"
                      onClick={() => setIntervals(String(n))}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {n} ({(target - start) / n} each)
                    </button>
                  </span>
                ))}
                .
              </p>
            )}
          </div>

          <div>
            <label htmlFor="goal-start-date" className="text-xs text-muted-foreground mb-1.5 block">Start date</label>
            <input
              id="goal-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`w-full min-w-0 bg-secondary/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 [color-scheme:light] dark:[color-scheme:dark] ${err(errors.startDate)}`}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">Defaults to today. Choose an earlier date for a goal already in progress.</p>
            {showErrors && errors.startDate && (
              <p className="text-[11px] text-destructive mt-1.5">Pick a start date.</p>
            )}
          </div>

          <div>
            <label htmlFor="goal-due-date" className="text-xs text-muted-foreground mb-1.5 block">Due date</label>
            <input
              id="goal-due-date"
              type="date"
              min={startDate || undefined}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={`w-full bg-secondary/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 [color-scheme:light] dark:[color-scheme:dark] ${err(errors.dueDate)}`}
            />
            {showErrors && errors.dueDate && (
              <p className="text-[11px] text-destructive mt-1.5">{!dueDate ? 'Pick a due date.' : 'Due date must be on or after the start date.'}</p>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowTimePicker(!showTimePicker)}
              className="w-full flex items-center justify-between bg-secondary/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground hover:border-primary/50 transition-colors"
            >
              <span className="text-xs text-muted-foreground">Time per interval</span>
              <span className="font-medium">{formatDuration(intervalSeconds)}</span>
            </button>
            {showTimePicker && (
              <div className="bg-secondary/20 rounded-xl p-3 mt-2 flex justify-center border border-border/30">
                <TimePicker
                  onSelect={setIntervalSeconds}
                  initialHours={Math.floor(intervalSeconds / 3600)}
                  initialMinutes={Math.floor((intervalSeconds % 3600) / 60)}
                  initialSeconds={intervalSeconds % 60}
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Color</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Tags</label>
            <TagInput
              tags={tags}
              onChange={setTags}
              existingTags={existingTags}
              inputValue={tagInput}
              onInputChange={setTagInput}
              placeholder="Tag the spawned task for bank filtering"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Copied onto each interval task the goal spawns into your Task Bank.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            aria-disabled={!canSubmit}
            className={`bg-primary hover:bg-primary/90 text-primary-foreground ${!isValid ? 'opacity-50' : ''}`}
          >
            {mode === 'edit' ? 'Save Changes' : 'Create Goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
