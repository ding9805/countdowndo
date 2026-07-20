'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Goal } from '@/lib/types';
import { GoalCard } from './goal-card';
import { GoalForm, GoalFormData } from './goal-form';
import { Button } from '@/components/ui/button';
import { Target, LogIn, Plus } from 'lucide-react';
import { PageToggle } from '@/components/page-toggle';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

export function GoalsPage() {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;

  const [goals, setGoals] = useState<Goal[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch('/api/goals');
      setGoals(res.ok ? await res.json() : []);
    } catch (e) {
      console.error('Failed to load goals:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags');
      if (res.ok) setExistingTags(await res.json());
    } catch (e) {
      console.error('Failed to load tags:', e);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchGoals();
      fetchTags();
    } else {
      setLoading(false);
    }
  }, [isLoggedIn, fetchGoals, fetchTags]);

  // Goal steps fire this event from the session engine (and cursor renames
  // land alongside bank updates), so reuse it to keep progress bars live and
  // the form's tag suggestions current.
  useEffect(() => {
    const handler = () => { if (isLoggedIn) { fetchGoals(); fetchTags(); } };
    window.addEventListener('bank-tasks-updated', handler);
    return () => window.removeEventListener('bank-tasks-updated', handler);
  }, [isLoggedIn, fetchGoals, fetchTags]);

  const activeCount = useMemo(() => goals.filter((g) => !g.completedAt).length, [goals]);

  const openCreate = () => { setEditingGoal(null); setFormOpen(true); };
  const openEdit = (goal: Goal) => { setEditingGoal(goal); setFormOpen(true); };

  const handleSubmit = async (data: GoalFormData) => {
    const isEdit = !!editingGoal;
    try {
      const res = await fetch(isEdit ? `/api/goals/${editingGoal!.id}` : '/api/goals', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to save goal');
      const saved = await res.json();
      setGoals((p) => (isEdit ? p.map((g) => (g.id === saved.id ? saved : g)) : [saved, ...p]));
      toast.success(isEdit ? 'Goal updated' : 'Goal created — its task is in your Task Bank');
      window.dispatchEvent(new Event('bank-tasks-updated'));
      fetchTags();
    } catch (e: any) {
      toast.error(e?.message ?? 'Something went wrong');
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    const prev = goals;
    setGoals((p) => p.filter((g) => g.id !== id));
    try {
      const res = await fetch(`/api/goals/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Goal deleted');
      window.dispatchEvent(new Event('bank-tasks-updated'));
    } catch {
      setGoals(prev);
      toast.error('Failed to delete goal');
    }
  };

  const handleSetCurrentValue = async (goal: Goal, value: number) => {
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentValue: value }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to update progress');
      const saved = await res.json();
      setGoals((p) => p.map((g) => (g.id === saved.id ? saved : g)));
      toast.success('Progress updated');
      window.dispatchEvent(new Event('bank-tasks-updated'));
    } catch (e: any) {
      toast.error(e?.message ?? 'Something went wrong');
    }
  };

  const handleRegenerate = async (id: string) => {
    try {
      const res = await fetch(`/api/goals/${id}/regenerate`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to regenerate task');
      const saved = await res.json();
      setGoals((p) => p.map((g) => (g.id === saved.id ? saved : g)));
      toast.success('Task recreated in your Task Bank');
      window.dispatchEvent(new Event('bank-tasks-updated'));
    } catch (e: any) {
      toast.error(e?.message ?? 'Something went wrong');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center glow-primary shrink-0">
              <Target className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground">Goals</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
            <PageToggle />
            {isLoggedIn && (
              <Button
                size="sm"
                onClick={openCreate}
                className="gradient-primary hover:opacity-90 text-primary-foreground font-semibold shadow-md"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">New Goal</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {!isLoggedIn ? (
          authStatus === 'loading' ? null : (
            <div className="glass-card rounded-2xl p-10 text-center max-w-md mx-auto mt-12">
              <Target className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="font-display text-lg font-semibold text-foreground mb-2">Sign in to track goals</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Goals break a big, quantifiable target into interval-sized tasks that flow through your Task Bank. They require an account to keep progress saved.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl gradient-primary text-primary-foreground hover:opacity-90 transition-all text-sm font-semibold shadow-md"
              >
                <LogIn className="w-4 h-4" />
                Log in
              </Link>
            </div>
          )
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-6">
              {activeCount} active goal{activeCount !== 1 ? 's' : ''}
            </p>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-16">Loading…</p>
            ) : goals.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-muted-foreground mb-4">
                  No goals yet. Create one and its first interval task will appear in your Task Bank.
                </p>
                <Button onClick={openCreate} className="gradient-primary hover:opacity-90 text-primary-foreground font-semibold shadow-md">
                  <Plus className="w-4 h-4 mr-1.5" />
                  New Goal
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <AnimatePresence initial={false}>
                  {goals.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onSetCurrentValue={handleSetCurrentValue}
                      onRegenerate={handleRegenerate}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>

      <GoalForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={editingGoal ? 'edit' : 'create'}
        initialGoal={editingGoal}
        existingTags={existingTags}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
