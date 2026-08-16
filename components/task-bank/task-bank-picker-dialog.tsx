'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { BankTask, Goal, PickedBankTask } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TaskBankCard } from './task-bank-card';
import { TagFilterBar } from './tag-filter-bar';
import { Archive, LogIn } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { cursorTaskNameOffset, remainingIntervals } from '@/lib/goal-utils';

interface TaskBankPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (picked: PickedBankTask[]) => void;
}

export function TaskBankPickerDialog({ open, onOpenChange, onConfirm }: TaskBankPickerDialogProps) {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;

  const [tasks, setTasks] = useState<BankTask[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // id -> how many times it has been added this visit. Plain one-offs cap at
  // 1; goal cursor tasks cap at the goal's remaining intervals (each add is
  // the next chunk); everything else can be added over and over.
  const [addCounts, setAddCounts] = useState<Record<string, number>>({});
  // Mirror of addCounts read synchronously by handlePick. Two clicks in the
  // same React batch (a double-click) would otherwise both see the pre-batch
  // state and build the same goal chunk name twice.
  const addCountsRef = useRef<Record<string, number>>({});
  const totalAdded = useMemo(
    () => Object.values(addCounts).reduce((sum, n) => sum + n, 0),
    [addCounts]
  );

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
    addCountsRef.current = {};
    setAddCounts({});
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
    if (activeTags.length === 0) return tasks;
    return tasks.filter((t) => t.tags.some((tag) => activeTags.includes(tag)));
  }, [tasks, activeTags]);

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
    const added = addCountsRef.current[id] ?? 0;
    const goal = goalByCursorId[id];
    // A one-off represents a single unit of work, but a goal's cursor task is
    // stored as a one-off and still has further interval chunks to hand out.
    if (task.isOneOff && !goal && added > 0) return;

    // Repeated adds of a goal's cursor task each get the next interval chunk
    // ("…: 10–20", then "…: 20–30", …) instead of duplicating the same name.
    let name: string | undefined;
    if (goal) {
      // All remaining intervals are already queued — nothing left to add.
      if (added >= remainingIntervals(goal)) return;
      name = cursorTaskNameOffset(goal, added);
    }

    addCountsRef.current = { ...addCountsRef.current, [id]: added + 1 };
    setAddCounts(addCountsRef.current);
    onConfirm([{ bankTask: task, name }]);
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
