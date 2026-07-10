'use client';

import React, { useState } from 'react';
import { SavedListData, Task } from '@/lib/types';
import { formatDuration } from '@/lib/timer-utils';
import { Save, FolderOpen, Trash2, Pencil, Check, X, BookmarkPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface SavedListsProps {
  savedLists: SavedListData[];
  currentTasks: Task[];
  onSaveList: (name: string) => void;
  onLoadList: (list: SavedListData) => void;
  onDeleteList: (id: string) => void;
  onRenameList: (id: string, newName: string) => void;
}

export function SavedLists({
  savedLists,
  currentTasks,
  onSaveList,
  onLoadList,
  onDeleteList,
  onRenameList,
}: SavedListsProps) {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleSave = () => {
    const name = (saveName ?? '').trim();
    if (!name) {
      toast.error('Enter a list name');
      return;
    }
    if ((currentTasks?.length ?? 0) === 0) {
      toast.error('Add tasks first before saving');
      return;
    }
    onSaveList?.(name);
    setSaveName('');
    setShowSaveForm(false);
  };

  const handleRename = (id: string) => {
    const name = (editName ?? '').trim();
    if (!name) return;
    onRenameList?.(id, name);
    setEditingId(null);
  };

  return (
    <div className="glass-card rounded-2xl p-5" style={{ boxShadow: 'var(--shadow-md)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-base font-semibold flex items-center gap-2">
          <BookmarkPlus className="w-4 h-4 text-primary" />
          Saved Lists
        </h3>
        <span className="text-xs text-muted-foreground">{(savedLists?.length ?? 0)}/3</span>
      </div>

      {/* Save current list */}
      <div className="mb-4">
        {!showSaveForm ? (
          <Button
            onClick={() => {
              // Default name to today's date
              const now = new Date();
              const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
              setSaveName(dateStr);
              setShowSaveForm(true);
            }}
            variant="outline"
            size="sm"
            className="w-full border-dashed border-primary/30 text-primary hover:bg-primary/10"
            disabled={(savedLists?.length ?? 0) >= 3}
          >
            <Save className="w-4 h-4 mr-2" />
            {(savedLists?.length ?? 0) >= 3 ? 'Max 3 lists reached' : 'Save Current List'}
          </Button>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="List name (e.g., Morning Routine)"
              value={saveName ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaveName(e?.target?.value ?? '')}
              onKeyDown={(e: React.KeyboardEvent) => { if (e?.key === 'Enter') handleSave(); }}
              className="bg-secondary/50 border-border text-sm"
              maxLength={50}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSaveForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Saved lists */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {(savedLists ?? []).map((list: SavedListData) => {
            const listTasks = (list?.tasks as any[]) ?? [];
            const totalDuration = listTasks.reduce((sum: number, t: any) => sum + (t?.durationSeconds ?? 0), 0);

            return (
              <motion.div
                key={list?.id ?? ''}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -50 }}
                className="bg-secondary/20 rounded-xl p-3 group border border-border/20"
              >
                {editingId === list?.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName ?? ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e?.target?.value ?? '')}
                      className="bg-secondary/50 border-border text-sm h-8"
                      maxLength={50}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e?.key === 'Enter') handleRename(list?.id); }}
                    />
                    <button onClick={() => handleRename(list?.id)} className="p-1 text-green-400 hover:text-green-300">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{list?.name ?? 'Untitled'}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditingId(list?.id); setEditName(list?.name ?? ''); }}
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onDeleteList?.(list?.id)}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {listTasks?.length ?? 0} tasks · {formatDuration(totalDuration)}
                    </p>
                    <Button
                      onClick={() => onLoadList?.(list)}
                      variant="ghost"
                      size="sm"
                      className="mt-2 w-full text-primary hover:bg-primary/10 text-xs"
                    >
                      <FolderOpen className="w-3 h-3 mr-1" />
                      Load List
                    </Button>
                  </>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {(savedLists?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No saved lists yet. Add tasks and save them for reuse.
          </p>
        )}
      </div>
    </div>
  );
}
