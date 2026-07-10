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
  confirmLabel?: string;
}

export function TaskBankPickerDialog({ open, onOpenChange, onConfirm, confirmLabel = 'Add Tasks' }: TaskBankPickerDialogProps) {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;

  const [tasks, setTasks] = useState<BankTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !isLoggedIn) return;
    setLoading(true);
    setSelectedIds([]);
    setActiveTags([]);
    fetch('/api/task-bank')
      .then((res) => (res.ok ? res.json() : []))
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const handleConfirm = () => {
    const selected = tasks.filter((t) => selectedIds.includes(t.id));
    onConfirm(selected);
    onOpenChange(false);
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
                    <Link href="/tasks" className="text-sm text-primary hover:underline font-medium">
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
                        selected={selectedIds.includes(task.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <span className="text-xs text-muted-foreground mr-auto self-center">
                {selectedIds.length} selected
              </span>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={handleConfirm}
                disabled={selectedIds.length === 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {confirmLabel} {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
