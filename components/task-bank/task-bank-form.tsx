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
import { Sparkles } from 'lucide-react';

interface TaskBankFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialTask?: BankTask | null;
  templates: BankTaskTemplate[];
  existingTags: string[];
  onSubmit: (data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[]; isOneOff: boolean }) => Promise<void> | void;
}

const DEFAULTS = { name: '', durationSeconds: 300, color: 'orange' as TaskColorId, tags: [] as string[], isOneOff: false };

export function TaskBankForm({ open, onOpenChange, mode, initialTask, templates, existingTags, onSubmit }: TaskBankFormProps) {
  const [name, setName] = useState(DEFAULTS.name);
  const [durationSeconds, setDurationSeconds] = useState(DEFAULTS.durationSeconds);
  const [color, setColor] = useState<TaskColorId>(DEFAULTS.color);
  const [tags, setTags] = useState<string[]>(DEFAULTS.tags);
  const [isOneOff, setIsOneOff] = useState(DEFAULTS.isOneOff);
  const [tagInput, setTagInput] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initialTask) {
      setName(initialTask.name);
      setDurationSeconds(initialTask.durationSeconds);
      setColor(initialTask.color);
      setTags(initialTask.tags);
      setIsOneOff(initialTask.isOneOff);
    } else {
      setName(DEFAULTS.name);
      setDurationSeconds(DEFAULTS.durationSeconds);
      setColor(DEFAULTS.color);
      setTags(DEFAULTS.tags);
      setIsOneOff(DEFAULTS.isOneOff);
    }
    setTagInput('');
    setTemplateId('');
    setShowTimePicker(false);
  }, [open, mode, initialTask]);

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
      await onSubmit({ name: trimmed, durationSeconds, color, tags: finalTags, isOneOff });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Task' : 'Edit Task'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {mode === 'create' && templates.length > 0 && (
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
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Task name</label>
            <Input
              autoFocus
              placeholder="e.g., Vacuum living room"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value.slice(0, 100))}
              maxLength={100}
              className="bg-secondary/60 border-border/50"
            />
          </div>

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

          <div className="flex items-center gap-3 bg-secondary/30 rounded-lg px-3 py-3 border border-border/40">
            <input
              type="checkbox"
              id="isOneOff"
              checked={isOneOff}
              onChange={(e) => setIsOneOff(e.target.checked)}
              className="w-4 h-4 rounded border-border/50 cursor-pointer"
            />
            <label htmlFor="isOneOff" className="text-xs text-muted-foreground cursor-pointer flex-1">
              <span className="font-medium text-foreground">One-off task</span>
              <br />
              Delete from bank when completed or removed from session
            </label>
          </div>
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
