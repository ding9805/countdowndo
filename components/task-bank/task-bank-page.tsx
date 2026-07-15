'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { BankTask, BankTaskTemplate, TaskColorId, TaskBankSortMode } from '@/lib/types';
import { TaskBankCard } from './task-bank-card';
import { TagFilterBar } from './tag-filter-bar';
import { TaskBankForm } from './task-bank-form';
import { TemplateManagerDialog } from './template-manager-dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Archive, LogIn } from 'lucide-react';
import { PageToggle } from '@/components/page-toggle';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { sortBankTasks, TASK_BANK_SORT_MODES } from '@/lib/task-bank-utils';

export function TaskBankPage() {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;

  const [tasks, setTasks] = useState<BankTask[]>([]);
  const [templates, setTemplates] = useState<BankTaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BankTask | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [sortMode, setSortMode] = useState<TaskBankSortMode>('recent');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, templatesRes] = await Promise.all([
        fetch('/api/task-bank'),
        fetch('/api/task-bank/templates'),
      ]);
      setTasks(tasksRes.ok ? await tasksRes.json() : []);
      setTemplates(templatesRes.ok ? await templatesRes.json() : []);
    } catch (e) {
      console.error('Failed to load task bank:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) fetchAll();
    else setLoading(false);
  }, [isLoggedIn, fetchAll]);

  useEffect(() => {
    const handler = () => { if (isLoggedIn) fetchAll(); };
    window.addEventListener('bank-tasks-updated', handler);
    return () => window.removeEventListener('bank-tasks-updated', handler);
  }, [isLoggedIn, fetchAll]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('countdowndo-bank-sort');
      if (saved && (TASK_BANK_SORT_MODES as readonly string[]).includes(saved)) {
        setSortMode(saved as TaskBankSortMode);
      }
    } catch {}
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (activeTags.length === 0) return tasks;
    return tasks.filter((t) => t.tags.some((tag) => activeTags.includes(tag)));
  }, [tasks, activeTags]);

  const visibleTasks = useMemo(() => sortBankTasks(filteredTasks, sortMode), [filteredTasks, sortMode]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const openEdit = (task: BankTask) => { setEditingTask(task); setFormOpen(true); };

  const handleCreate = async (data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[]; isOneOff: boolean; dueDate: string | null }) => {
    // Optimistic create: insert a temp row immediately, swap in the server row
    // on success, roll back on failure — same pattern as handleDelete below.
    const tempId = `temp-${Date.now()}`;
    const optimistic: BankTask = {
      id: tempId,
      name: data.name,
      durationSeconds: data.durationSeconds,
      color: data.color,
      tags: data.tags,
      isOneOff: data.isOneOff,
      dueDate: data.dueDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const prev = tasks;
    setTasks((p) => [optimistic, ...p]);
    void (async () => {
      try {
        const res = await fetch('/api/task-bank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to create task');
        const created = await res.json();
        setTasks((p) => p.map((t) => (t.id === tempId ? created : t)));
        toast.success('Task added to bank');
      } catch (e: any) {
        setTasks(prev);
        toast.error(e?.message ?? 'Something went wrong');
      }
    })();
  };

  const handleEdit = async (data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[]; isOneOff: boolean; dueDate: string | null }) => {
    if (!editingTask) return;
    // Optimistic edit: patch the row in place immediately, close the dialog,
    // replace with the server row on success, roll back on failure.
    const prev = tasks;
    const optimistic: BankTask = { ...editingTask, ...data };
    setTasks((p) => p.map((t) => (t.id === editingTask.id ? optimistic : t)));
    void (async () => {
      try {
        const res = await fetch(`/api/task-bank/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to update task');
        const updated = await res.json();
        setTasks((p) => p.map((t) => (t.id === updated.id ? updated : t)));
        toast.success('Task updated');
      } catch (e: any) {
        setTasks(prev);
        toast.error(e?.message ?? 'Something went wrong');
      }
    })();
  };

  const handleDelete = async (id: string) => {
    const prev = tasks;
    setTasks((p) => p.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/task-bank/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Task deleted');
    } catch {
      setTasks(prev);
      toast.error('Failed to delete task');
    }
  };

  const handleCreateTemplate = async (data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[] }) => {
    const tempId = `temp-${Date.now()}`;
    const optimistic: BankTaskTemplate = {
      id: tempId,
      name: data.name,
      durationSeconds: data.durationSeconds,
      color: data.color,
      tags: data.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const prev = templates;
    setTemplates((p) => [optimistic, ...p]);
    void (async () => {
      try {
        const res = await fetch('/api/task-bank/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to create template');
        const created = await res.json();
        setTemplates((p) => p.map((t) => (t.id === tempId ? created : t)));
        toast.success('Template created');
      } catch (e: any) {
        setTemplates(prev);
        toast.error(e?.message ?? 'Something went wrong');
      }
    })();
  };

  const handleUpdateTemplate = async (id: string, data: { name: string; durationSeconds: number; color: TaskColorId; tags: string[] }) => {
    const prev = templates;
    const existing = templates.find((t) => t.id === id);
    if (!existing) return;
    const optimistic: BankTaskTemplate = { ...existing, ...data };
    setTemplates((p) => p.map((t) => (t.id === id ? optimistic : t)));
    void (async () => {
      try {
        const res = await fetch(`/api/task-bank/templates/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error((await res.json())?.error ?? 'Failed to update template');
        const updated = await res.json();
        setTemplates((p) => p.map((t) => (t.id === updated.id ? updated : t)));
        toast.success('Template updated');
      } catch (e: any) {
        setTemplates(prev);
        toast.error(e?.message ?? 'Something went wrong');
      }
    })();
  };

  const handleDeleteTemplate = async (id: string) => {
    const prev = templates;
    setTemplates((p) => p.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/task-bank/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Template deleted');
    } catch {
      setTemplates(prev);
      toast.error('Failed to delete template');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center glow-primary shrink-0">
              <Archive className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground">Task Bank</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
            <PageToggle />
            {isLoggedIn && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTemplatesOpen(true)}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Templates</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {!isLoggedIn ? (
          authStatus === 'loading' ? null : (
            <div className="glass-card rounded-2xl p-10 text-center max-w-md mx-auto mt-12">
              <Archive className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="font-display text-lg font-semibold text-foreground mb-2">Sign in to use the Task Bank</h2>
              <p className="text-sm text-muted-foreground mb-6">
                The Task Bank stores your reusable tasks so they're ready to drop into any session. It requires an account to keep them saved.
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
            <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {tasks.length} task{tasks.length !== 1 ? 's' : ''} in your bank
                </p>
                <select
                  value={sortMode}
                  onChange={(e) => {
                    const next = e.target.value as TaskBankSortMode;
                    setSortMode(next);
                    try { localStorage.setItem('countdowndo-bank-sort', next); } catch {}
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg bg-secondary/60 border border-border/50 text-foreground focus:outline-none focus:border-primary/50"
                >
                  <option value="recent">Recently added</option>
                  <option value="due">Due date</option>
                  <option value="alpha">A–Z</option>
                </select>
              </div>
            </div>

            <TaskBankForm
              inline
              mode="create"
              open={false}
              onOpenChange={() => {}}
              templates={templates}
              existingTags={allTags}
              onSubmit={handleCreate}
            />

            <div className="mb-6">
              <TagFilterBar allTags={allTags} activeTags={activeTags} onToggle={toggleTag} onClear={() => setActiveTags([])} />
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-16">Loading…</p>
            ) : visibleTasks.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-muted-foreground">
                  {tasks.length === 0
                    ? 'No tasks in your bank yet. Create one to get started.'
                    : 'No tasks match the selected tags.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <AnimatePresence initial={false}>
                  {visibleTasks.map((task) => (
                    <TaskBankCard key={task.id} task={task} onEdit={openEdit} onDelete={handleDelete} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>

      <TaskBankForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="edit"
        initialTask={editingTask}
        templates={templates}
        existingTags={allTags}
        onSubmit={handleEdit}
      />

      <TemplateManagerDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        templates={templates}
        existingTags={allTags}
        onCreate={handleCreateTemplate}
        onUpdate={handleUpdateTemplate}
        onDelete={handleDeleteTemplate}
      />
    </div>
  );
}
