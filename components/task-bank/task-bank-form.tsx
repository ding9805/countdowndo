'use client';

import React, { useState, useEffect } from 'react';
import { BankTask, BankTaskTemplate, TaskColorId } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/color-picker';
import { TimePicker } from '@/components/time-picker';
import { TagInput, mergePendingTag } from './tag-input';
import { formatDuration } from '@/lib/timer-utils';
import { Sparkles, Plus, X, ChevronDown } from 'lucide-react';

interface TaskBankFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialTask?: BankTask | null;
  templates: BankTaskTemplate[];
  existingTags: string[];
  onSubmit: (data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[]; isOneOff: boolean; dueDate: string | null }) => Promise<void> | void;
  // When true, render the form inline (no dialog) for create mode. Always shown,
  // resets fields after submit instead of closing. Edit still uses the dialog.
  inline?: boolean;
}

const DEFAULTS = { name: '', durationSeconds: 300, color: 'orange' as TaskColorId, tags: [] as string[], isOneOff: false, dueDate: '' };

export function TaskBankForm({ open, onOpenChange, mode, initialTask, templates, existingTags, onSubmit, inline }: TaskBankFormProps) {
  const [name, setName] = useState(DEFAULTS.name);
  const [durationSeconds, setDurationSeconds] = useState(DEFAULTS.durationSeconds);
  const [color, setColor] = useState<TaskColorId>(DEFAULTS.color);
  const [tags, setTags] = useState<string[]>(DEFAULTS.tags);
  const [isOneOff, setIsOneOff] = useState(DEFAULTS.isOneOff);
  const [dueDate, setDueDate] = useState(DEFAULTS.dueDate);
  const [tagInput, setTagInput] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (inline) return;
    if (!open) return;
    if (mode === 'edit' && initialTask) {
      setName(initialTask.name);
      setDurationSeconds(initialTask.durationSeconds);
      setColor(initialTask.color);
      setTags(initialTask.tags);
      setIsOneOff(initialTask.isOneOff);
      setDueDate(initialTask.dueDate ?? '');
    } else {
      setName(DEFAULTS.name);
      setDurationSeconds(DEFAULTS.durationSeconds);
      setColor(DEFAULTS.color);
      setTags(DEFAULTS.tags);
      setIsOneOff(DEFAULTS.isOneOff);
      setDueDate(DEFAULTS.dueDate);
    }
    setTagInput('');
    setTemplateId('');
    setShowTimePicker(false);
  }, [open, mode, initialTask, inline]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    setColor(template.color);
    setDurationSeconds(template.durationSeconds);
    setTags(template.tags);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Flush any tag text typed but not yet committed with Enter/comma.
    const finalTags = mergePendingTag(tags, tagInput);
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmed, durationSeconds, color, tags: finalTags, isOneOff, dueDate: dueDate || null });
      if (inline) {
        // Reset to defaults so the next task starts blank.
        setName(DEFAULTS.name);
        setDurationSeconds(DEFAULTS.durationSeconds);
        setColor(DEFAULTS.color);
        setTags(DEFAULTS.tags);
        setIsOneOff(DEFAULTS.isOneOff);
        setDueDate(DEFAULTS.dueDate);
        setTagInput('');
        setTemplateId('');
        setShowTimePicker(false);
        setShowAdvanced(false);
      } else {
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Suffix the checkbox id by mode so the inline form and the edit dialog —
  // which can both be mounted at once — never share a duplicate HTML id.
  const oneOffId = `isOneOff-${mode}${inline ? '-inline' : ''}`;

  const templateField = mode === 'create' && templates.length > 0 && (
    <div>
      <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
        <Sparkles className="w-3.5 h-3.5" />
        Start from a template (optional)
      </label>
      <select
        value={templateId}
        onChange={(e) => applyTemplate(e.target.value)}
        className="w-full bg-secondary/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
      >
        <option value="">No template — start blank</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );

  const nameField = (
    <div>
      <label className="text-xs text-muted-foreground mb-1.5 block">Task name</label>
      <Input
        autoFocus={!inline}
        placeholder="e.g., Vacuum living room"
        value={name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value.slice(0, 100))}
        maxLength={100}
        className="bg-secondary/60 border-border/50"
      />
    </div>
  );

  // Advanced fields are always visible on desktop (lg:block) and behind a
  // "More options" toggle on mobile. Kept together so both the inline card and
  // the edit dialog can compose them in a single collapsible block.
  const advancedFields = (
    <>
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowTimePicker(!showTimePicker)}
          className="w-full flex items-center justify-between bg-secondary/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground hover:border-primary/50 transition-colors"
        >
          <span className="text-xs text-muted-foreground">Duration</span>
          <span className="font-medium">{formatDuration(durationSeconds)}</span>
        </button>
        {showTimePicker && (
          <div className="bg-secondary/20 rounded-xl p-3 mt-2 flex justify-center border border-border/30">
            <TimePicker
              onSelect={setDurationSeconds}
              initialHours={Math.floor(durationSeconds / 3600)}
              initialMinutes={Math.floor((durationSeconds % 3600) / 60)}
              initialSeconds={durationSeconds % 60}
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Tags</label>
        <TagInput tags={tags} onChange={setTags} existingTags={existingTags} inputValue={tagInput} onInputChange={setTagInput} />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Due date (optional)</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="flex-1 bg-secondary/60 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 [color-scheme:dark]"
          />
          {dueDate && (
            <button
              type="button"
              onClick={() => setDueDate('')}
              className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 bg-secondary/30 rounded-lg px-3 py-3 border border-border/40">
        <input
          type="checkbox"
          id={oneOffId}
          checked={isOneOff}
          onChange={(e) => setIsOneOff(e.target.checked)}
          className="w-4 h-4 rounded border-border/50 cursor-pointer"
        />
        <label htmlFor={oneOffId} className="text-xs text-muted-foreground cursor-pointer flex-1">
          <span className="font-medium text-foreground">One-off task</span>
          <br />
          Delete from bank when completed or removed from session
        </label>
      </div>
    </>
  );

  if (inline) {
    return (
      <div className="glass-card rounded-xl p-4 sm:p-5 mb-6 lg:mb-0 lg:sticky lg:top-20 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg gradient-primary flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-primary-foreground" />
          </div>
          <h2 className="font-display text-sm font-semibold text-foreground">Add a task</h2>
        </div>

        {nameField}

        <div className={`${showAdvanced ? 'block space-y-4' : 'hidden'} lg:block lg:space-y-4`}>
          {templateField}
          {advancedFields}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced((v) => !v)}
            className="lg:hidden text-muted-foreground"
          >
            <ChevronDown className={`w-4 h-4 mr-1 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            {showAdvanced ? 'Hide options' : 'More options'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="gradient-primary hover:opacity-90 text-primary-foreground font-semibold shadow-md ml-auto"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {submitting ? 'Adding…' : 'Add Task'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Task' : 'Edit Task'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {templateField}
          {nameField}
          {advancedFields}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {mode === 'create' ? 'Create Task' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
