'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { BankTask, Goal, PickedBankTask, Task } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TaskBankCard } from './task-bank-card';
import { TagFilterBar } from './tag-filter-bar';
import { Archive, LogIn } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cursorTaskNameOffset, remainingIntervals } from '@/lib/goal-utils';
import { countQueuedBankCopies } from '@/lib/task-bank-utils';

interface TaskBankPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (picked: PickedBankTask[]) => void;
  sessionTasks: Task[];
  onRemove: (bankTaskId: string, name?: string) => void;
}

export function TaskBankPickerDialog({ open, onOpenChange, onConfirm, onRemove, sessionTasks }: TaskBankPickerDialogProps) {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;

  const [tasks, setTasks] = useState<BankTask[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const queuedCounts = countQueuedBankCopies(sessionTasks);
  const queuedCountsRef = useRef(queuedCounts);
  queuedCountsRef.current = queuedCounts;
  const totalQueued = Object.values(queuedCounts).reduce((sum, count) => sum + count, 0);

  const loadBankData = useCallback(async () => {
    try {
      const [tasksRes, goalsRes] = await Promise.all([
        fetch('/api/task-bank'),
        fetch('/api/goals'),
      ]);
      setTasks(tasksRes.ok ? await tasksRes.json() : []);
      setGoals(goalsRes.ok ? await goalsRes.json() : []);
    } catch (e) {
      console.error('Failed to load task bank/goals:', e);
      setTasks([]);
      setGoals([]);
    }
  }, []);

  useEffect(() => {
    if (!open || !isLoggedIn) return;
    setLoading(true);
    setSearch('');
    toast.dismiss('bank-add');
    setActiveTags([]);
    loadBankData().finally(() => setLoading(false));
  }, [open, isLoggedIn, loadBankData]);

  useEffect(() => {
    const handler = () => {
      if (!open || !isLoggedIn) return;
      loadBankData();
    };
    window.addEventListener('bank-tasks-updated', handler);
    return () => window.removeEventListener('bank-tasks-updated', handler);
  }, [open, isLoggedIn, loadBankData]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return tasks.filter((task) =>
      (!query || task.name.toLocaleLowerCase().includes(query)) &&
      (activeTags.length === 0 || task.tags.some((tag) => activeTags.includes(tag)))
    );
  }, [tasks, activeTags, search]);

  // bankTaskId -> the goal whose cursor task it is, used to increment repeated
  // adds of that task into the session (each copy is the next interval chunk).
  const goalByCursorId = useMemo(() => {
    const map: Record<string, Goal> = {};
    goals.forEach((g) => {
      if (g.bankTaskId) map[g.bankTaskId] = g;
    });
    return map;
  }, [goals]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handlePick = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const queued = queuedCountsRef.current[id] ?? 0;
    const goal = goalByCursorId[id];
    // A one-off represents a single unit of work, but a goal's cursor task is
    // stored as a one-off and still has further interval chunks to hand out.
    if (task.isOneOff && !goal && queued > 0) return;

    // Repeated adds of a goal's cursor task each get the next interval chunk
    // ("…: 10–20", then "…: 20–30", …) instead of duplicating the same name.
    let name: string | undefined;
    if (goal) {
      // All remaining intervals are already queued — nothing left to add.
      if (queued >= remainingIntervals(goal)) return;
      name = cursorTaskNameOffset(goal, queued);
    }

    queuedCountsRef.current = { ...queuedCountsRef.current, [id]: queued + 1 };
    onConfirm([{ bankTask: task, name }]);
  };

  const handleRemove = (id: string) => {
    const count = queuedCountsRef.current[id] ?? 0;
    if (count === 0) return;
    queuedCountsRef.current = { ...queuedCountsRef.current, [id]: count - 1 };
    const goal = goalByCursorId[id];
    onRemove(id, goal ? cursorTaskNameOffset(goal, count - 1) : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col p-4 sm:p-6">
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
            <Input aria-label="Search Task Bank" placeholder="Search tasks…" value={search} onChange={(event) => setSearch(event.target.value)} className="shrink-0 text-base" />
            <div className="overflow-y-auto overscroll-contain min-h-0 flex-1 space-y-3 -mx-1 px-1">
              <TagFilterBar allTags={allTags} activeTags={activeTags} onToggle={toggleTag} onClear={() => setActiveTags([])} />

              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-10">Loading…</p>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground mb-3">
                    {tasks.length === 0 ? 'Your task bank is empty.' : 'No tasks match your search or tags.'}
                  </p>
                  {tasks.length === 0 && (
                    <Link href="/bank" className="text-sm text-primary hover:underline font-medium">
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
                        selected={(queuedCounts[task.id] ?? 0) > 0}
                        addedCount={queuedCounts[task.id] ?? 0}
                        addDisabled={goalByCursorId[task.id]
                          ? (queuedCounts[task.id] ?? 0) >= remainingIntervals(goalByCursorId[task.id])
                          : !!task.isOneOff && (queuedCounts[task.id] ?? 0) > 0}
                        onRemove={handleRemove}
                        onToggleSelect={handlePick}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t pt-3">
              <span className="text-xs text-muted-foreground mr-auto self-center">
                {totalQueued > 0 ? `${totalQueued} queued` : 'Tap + to add a task'}
              </span>
              <Button
                onClick={() => onOpenChange(false)}
                className="min-h-11 min-w-24 bg-primary hover:bg-primary/90 text-primary-foreground"
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
