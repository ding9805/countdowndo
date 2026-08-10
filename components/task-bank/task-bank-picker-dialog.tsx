'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { BankTask } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TaskBankCard } from './task-bank-card';
import { TagFilterBar } from './tag-filter-bar';
import { Archive, LogIn } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';

interface TaskBankPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (tasks: BankTask[]) => void;
}

export function TaskBankPickerDialog({ open, onOpenChange, onConfirm }: TaskBankPickerDialogProps) {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;

  const [tasks, setTasks] = useState<BankTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // id -> how many times it has been added this visit. One-offs (including
  // goal interval tasks, which arrive as one-offs) cap at 1; everything else
  // can be added over and over without reopening the dialog.
  const [addCounts, setAddCounts] = useState<Record<string, number>>({});
  const totalAdded = useMemo(
    () => Object.values(addCounts).reduce((sum, n) => sum + n, 0),
    [addCounts]
  );

  useEffect(() => {
    if (!open || !isLoggedIn) return;
    setLoading(true);
    setAddCounts({});
    setActiveTags([]);
    fetch('/api/task-bank')
      .then((res) => (res.ok ? res.json() : []))
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [open, isLoggedIn]);

  useEffect(() => {
    const handler = () => {
      if (!open || !isLoggedIn) return;
      fetch('/api/task-bank')
        .then((res) => (res.ok ? res.json() : []))
        .then(setTasks)
        .catch(() => setTasks([]));
    };
    window.addEventListener('bank-tasks-updated', handler);
    return () => window.removeEventListener('bank-tasks-updated', handler);
  }, [open, isLoggedIn]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (activeTags.length === 0) return tasks;
    return tasks.filter((t) => t.tags.some((tag) => activeTags.includes(tag)));
  }, [tasks, activeTags]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handlePick = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    // A one-off represents a single unit of work (a goal's 10→20 interval, say)
    // — adding it twice would be meaningless, so it stays single-add.
    if (task.isOneOff && (addCounts[id] ?? 0) > 0) return;
    setAddCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    onConfirm([task]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add from Task Bank</DialogTitle>
        </DialogHeader>

        {!isLoggedIn ? (
          <div className="text-center py-8">
            <Archive className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Sign in to use your Task Bank.</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl gradient-primary text-primary-foreground hover:opacity-90 transition-all text-sm font-semibold shadow-md"
            >
              <LogIn className="w-4 h-4" />
              Log in
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto flex-1 space-y-3 -mx-1 px-1">
              <TagFilterBar allTags={allTags} activeTags={activeTags} onToggle={toggleTag} onClear={() => setActiveTags([])} />

              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground mb-3">
                    {tasks.length === 0 ? 'Your task bank is empty.' : 'No tasks match the selected tags.'}
                  </p>
                  {tasks.length === 0 && (
                    <Link href="/" className="text-sm text-primary hover:underline font-medium">
                      Go create some tasks →
                    </Link>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {filteredTasks.map((task) => (
                      <TaskBankCard
                        key={task.id}
                        task={task}
                        selectable
                        selected={(addCounts[task.id] ?? 0) > 0}
                        addedCount={addCounts[task.id] ?? 0}
                        onToggleSelect={handlePick}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <span className="text-xs text-muted-foreground mr-auto self-center">
                {totalAdded > 0 ? `${totalAdded} added` : 'Tap a task to add it'}
              </span>
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
