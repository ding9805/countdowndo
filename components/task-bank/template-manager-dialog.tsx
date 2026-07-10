'use client';

import React, { useState, useEffect } from 'react';
import { BankTaskTemplate, TaskColorId, getTaskColorHex } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/color-picker';
import { TimePicker } from '@/components/time-picker';
import { TagInput, mergePendingTag } from './tag-input';
import { formatDuration } from '@/lib/timer-utils';
import { Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react';

interface TemplateManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: BankTaskTemplate[];
  existingTags: string[];
  onCreate: (data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[] }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const DEFAULTS = { name: '', durationSeconds: 300, color: 'orange' as TaskColorId, tags: [] as string[] };

export function TemplateManagerDialog({ open, onOpenChange, templates, existingTags, onCreate, onUpdate, onDelete }: TemplateManagerDialogProps) {
  const [editing, setEditing] = useState<BankTaskTemplate | 'new' | null>(null);
  const [name, setName] = useState(DEFAULTS.name);
  const [durationSeconds, setDurationSeconds] = useState(DEFAULTS.durationSeconds);
  const [color, setColor] = useState<TaskColorId>(DEFAULTS.color);
  const [tags, setTags] = useState<string[]>(DEFAULTS.tags);
  const [tagInput, setTagInput] = useState('');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) { setEditing(null); return; }
  }, [open]);

  useEffect(() => {
    if (editing === 'new') {
      setName(DEFAULTS.name);
      setDurationSeconds(DEFAULTS.durationSeconds);
      setColor(DEFAULTS.color);
      setTags(DEFAULTS.tags);
    } else if (editing) {
      setName(editing.name);
      setDurationSeconds(editing.durationSeconds);
      setColor(editing.color);
      setTags(editing.tags);
    }
    setTagInput('');
    setShowTimePicker(false);
  }, [editing]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Flush any tag text typed but not yet committed with Enter/comma.
    const finalTags = mergePendingTag(tags, tagInput);
    setSubmitting(true);
    try {
      if (editing === 'new') {
        await onCreate({ name: trimmed, durationSeconds, color, tags: finalTags });
      } else if (editing) {
        await onUpdate(editing.id, { name: trimmed, durationSeconds, color, tags: finalTags });
      }
      setEditing(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing && (
              <button onClick={() => setEditing(null)} className="p-1 -ml-1 rounded hover:bg-secondary/50">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {editing === 'new' ? 'New Template' : editing ? 'Edit Template' : 'Manage Templates'}
          </DialogTitle>
        </DialogHeader>

        {!editing ? (
          <div className="space-y-3">
            <Button
              onClick={() => setEditing('new')}
              variant="outline"
              className="w-full border-dashed border-primary/40 text-primary hover:bg-primary/10"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Template
            </Button>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {templates.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No templates yet. Templates let you predefine color, tags, and duration so new tasks only need a name.
                </p>
              )}
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-secondary/20 border border-border/20"
                  style={{ borderLeft: `3px solid ${getTaskColorHex(t.color)}` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{formatDuration(t.durationSeconds)}</span>
                      {t.tags.map((tag) => (
                        <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded-full bg-secondary/50 text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setEditing(t)} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(t.id)} className="p-1.5 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Template name</label>
              <Input
                autoFocus
                placeholder="e.g., Household Chore"
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

            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={!name.trim() || submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {editing === 'new' ? 'Create Template' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
