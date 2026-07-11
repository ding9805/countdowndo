'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Task, SessionMode, TaskOrder, TaskColorId, TASK_COLORS, getTaskColorHex } from '@/lib/types';
import { ColorPicker } from './color-picker';
import { formatDuration } from '@/lib/timer-utils';
import { TimePicker } from './time-picker';
import { StartTimePicker } from './start-time-picker';
import { Plus, Play, GripVertical, X, Pencil, Clock, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Zap, Infinity, ArrowUpDown, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';

interface TaskInputPanelProps {
  tasks: Task[];
  sessionMode: SessionMode;
  taskOrder: TaskOrder;
  planningStartTime: string | null;
  onToggleOrder: () => void;
  onPlanningStartTimeChange: (time: string | null) => void;
  onSessionModeChange: (mode: SessionMode) => void;
  onAddTask: (name: string, durationSeconds: number, position?: 'top' | 'bottom', color?: TaskColorId) => void;
  onDeleteTask: (id: string) => void;
  onEditTask: (id: string, name: string, durationSeconds: number, color?: TaskColorId) => void;
  onReorder: (tasks: Task[]) => void;
  onStartSession: () => void;
  onOpenTaskBank: () => void;
}

export function TaskInputPanel({
  tasks,
  sessionMode,
  taskOrder,
  planningStartTime,
  onToggleOrder,
  onPlanningStartTimeChange,
  onSessionModeChange,
  onAddTask,
  onDeleteTask,
  onEditTask,
  onReorder,
  onStartSession,
  onOpenTaskBank,
}: TaskInputPanelProps) {
  const [taskName, setTaskName] = useState('');
  const [duration, setDuration] = useState(300); // 5 min default
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDuration, setEditDuration] = useState(300);
  const [showEditPicker, setShowEditPicker] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [selectedColor, setSelectedColor] = useState<TaskColorId>('orange');
  const [editColor, setEditColor] = useState<TaskColorId>('orange');
  const [addTaskCollapsed, setAddTaskCollapsed] = useState(false);
  const [startTimeCollapsed, setStartTimeCollapsed] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  // Track known task IDs to prevent entrance animation flicker on existing tasks
  const knownTaskIds = useRef<Set<string>>(new Set((tasks ?? []).map((t: Task) => t?.id).filter(Boolean)));
  useEffect(() => {
    const timer = setTimeout(() => {
      (tasks ?? []).forEach((t: Task) => { if (t?.id) knownTaskIds.current.add(t.id); });
    }, 400);
    return () => clearTimeout(timer);
  }, [tasks]);

  const handleAdd = (position: 'top' | 'bottom' = 'bottom') => {
    const name = (taskName ?? '').trim();
    if (!name) return;
    onAddTask?.(name, duration ?? 300, position, selectedColor);
    setTaskName('');
    setDuration(300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e?.key === 'Enter') handleAdd('bottom');
  };

  const isAsc = taskOrder === 'asc';
  // Display tasks: reversed when ascending
  const displayTasks = isAsc ? [...(tasks ?? [])].reverse() : (tasks ?? []);
  // Map display index to real index
  const toRealIdx = (displayIdx: number) => isAsc ? (tasks?.length ?? 0) - 1 - displayIdx : displayIdx;

  const handleDragStart = (displayIdx: number) => {
    dragItem.current = displayIdx;
  };

  const handleDragOver = (e: React.DragEvent, displayIdx: number) => {
    e?.preventDefault?.();
    dragOverItem.current = displayIdx;
  };

  const handleDrop = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const realFrom = toRealIdx(dragItem.current);
    const realTo = toRealIdx(dragOverItem.current);
    const newTasks = [...(tasks ?? [])];
    const [dragged] = newTasks.splice(realFrom, 1);
    if (dragged) newTasks.splice(realTo, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;
    onReorder?.(newTasks);
  };

  const moveTask = (displayIdx: number, direction: 'up' | 'down') => {
    // In ascending view, visual "up" = move to higher real index ("down" in data)
    const realIdx = toRealIdx(displayIdx);
    const realDirection = isAsc ? (direction === 'up' ? 'down' : 'up') : direction;
    const newIdx = realDirection === 'up' ? realIdx - 1 : realIdx + 1;
    if (newIdx < 0 || newIdx >= (tasks?.length ?? 0)) return;
    const newTasks = [...(tasks ?? [])];
    const [moved] = newTasks.splice(realIdx, 1);
    if (moved) newTasks.splice(newIdx, 0, moved);
    onReorder?.(newTasks);
  };

  const moveTaskToEdge = (displayIdx: number, edge: 'top' | 'bottom') => {
    const realIdx = toRealIdx(displayIdx);
    // Visual "top" in asc view = real last index; visual "bottom" in asc view = real index 0
    const targetIdx = isAsc
      ? (edge === 'top' ? (tasks?.length ?? 1) - 1 : 0)
      : (edge === 'top' ? 0 : (tasks?.length ?? 1) - 1);
    if (realIdx === targetIdx) return;
    const newTasks = [...(tasks ?? [])];
    const [moved] = newTasks.splice(realIdx, 1);
    if (moved) newTasks.splice(targetIdx, 0, moved);
    onReorder?.(newTasks);
  };

  const startEdit = (task: Task) => {
    setEditingId(task?.id ?? null);
    setEditName(task?.name ?? '');
    setEditDuration(task?.durationSeconds ?? 300);
    setEditColor(task?.color ?? 'orange');
    setShowEditPicker(true);
  };

  const saveEdit = () => {
    if (editingId && (editName ?? '').trim()) {
      onEditTask?.(editingId, (editName ?? '').trim(), editDuration ?? 300, editColor);
    }
    setEditingId(null);
    setShowEditPicker(false);
  };

  const handleClearAll = () => {
    (tasks ?? []).forEach((task: Task) => {
      onDeleteTask?.(task?.id);
    });
    setShowClearConfirm(false);
  };

  // Compute start time in ms for end-time calculations
  const startTimeMs = (() => {
    if (!planningStartTime) return null;
    const [h, m] = planningStartTime.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  })();

  const getTaskEndTime = (task: Task): string | null => {
    if (startTimeMs === null) return null;
    const endMs = startTimeMs + (task?.cumulativeSeconds ?? 0) * 1000;
    const d = new Date(endMs);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="space-y-6">
      {/* Add task form — collapsible */}
      <div className="glass-card rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-md)' }}>
        <button
          type="button"
          onClick={() => setAddTaskCollapsed(!addTaskCollapsed)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors"
        >
          <h2 className="font-display text-lg font-semibold flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Add Task
          </h2>
          {addTaskCollapsed ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        <AnimatePresence initial={false}>
          {!addTaskCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 sm:px-6 pt-1 pb-6">
                <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
                  {/* Left: Task name + color picker + add buttons */}
                  <div className="flex-1 flex flex-col gap-3">
                    <Input
                      placeholder="Task name (e.g., Brew coffee)"
                      value={taskName ?? ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaskName((e?.target?.value ?? '').slice(0, 100))}
                      onKeyDown={handleKeyDown}
                      maxLength={100}
                      className="bg-secondary/60 border-border/50 focus-visible:border-primary/50"
                    />
                    <ColorPicker value={selectedColor} onChange={setSelectedColor} />
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button
                        onClick={() => handleAdd('bottom')}
                        disabled={!(taskName ?? '').trim()}
                        className="gradient-primary hover:opacity-90 text-primary-foreground font-semibold rounded-xl shadow-md"
                        title="Add task to end of list (do last)"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add to Bottom
                      </Button>
                      <Button
                        onClick={() => handleAdd('top')}
                        disabled={!(taskName ?? '').trim()}
                        variant="outline"
                        className="border-primary/40 text-primary hover:bg-primary/10 rounded-xl"
                        title="Add task to start of list (do first)"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add to Top
                      </Button>
                      <Button
                        onClick={onOpenTaskBank}
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground rounded-xl"
                        title="Add tasks from your Task Bank"
                      >
                        <Archive className="w-4 h-4 mr-1" />
                        From Task Bank
                      </Button>
                    </div>
                  </div>

                  {/* Right: Time picker scroll wheels */}
                  <div className="bg-secondary/20 rounded-xl p-3 flex items-center justify-center sm:justify-start border border-border/30">
                    <TimePicker
                      onSelect={(s: number) => setDuration(s)}
                      initialHours={Math.floor((duration ?? 300) / 3600)}
                      initialMinutes={Math.floor(((duration ?? 300) % 3600) / 60)}
                      initialSeconds={(duration ?? 300) % 60}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Start time picker — collapsible */}
      {(tasks?.length ?? 0) > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <button
            type="button"
            onClick={() => setStartTimeCollapsed(!startTimeCollapsed)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Start time</span>
            </div>
            <div className="flex items-center gap-3">
              {startTimeMs !== null && (
                <span className="text-sm text-primary font-medium">
                  Session ends {getTaskEndTime((tasks ?? [])[(tasks?.length ?? 1) - 1])}
                </span>
              )}
              {startTimeCollapsed ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>

          <AnimatePresence initial={false}>
            {!startTimeCollapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 flex justify-center">
                  <StartTimePicker
                    value={planningStartTime}
                    onChange={(v) => onPlanningStartTimeChange(v)}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="space-y-2">
        {(tasks?.length ?? 0) > 0 && (
          <div className="flex items-center justify-between">
            <button
              onClick={onToggleOrder}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title={isAsc ? 'Showing earliest last → Switch to earliest first' : 'Showing earliest first → Switch to earliest last'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {isAsc ? 'Earliest last' : 'Earliest first'}
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="text-xs px-3 py-1 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
        <AnimatePresence initial={false}>
          {displayTasks.map((task: Task, displayIdx: number) => (
            <motion.div
              key={task?.id ?? displayIdx}
              layout="position"
              initial={knownTaskIds.current.has(task?.id) ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ layout: { type: 'spring', bounce: 0.15, duration: 0.4 } }}
              draggable
              onDragStart={() => handleDragStart(displayIdx)}
              onDragOver={(e: any) => handleDragOver(e, displayIdx)}
              onDrop={handleDrop}
              className="glass-card glass-card-hover rounded-xl overflow-hidden flex items-center gap-4 cursor-grab active:cursor-grabbing group transition-all"
              style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `3px solid ${getTaskColorHex(task?.color)}` }}
            >
              {/* Reorder controls */}
              <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => moveTaskToEdge(displayIdx, 'top')}
                  disabled={displayIdx === 0}
                  className="p-1.5 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  title="Move to top"
                >
                  <ChevronsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => moveTask(displayIdx, 'up')}
                  disabled={displayIdx === 0}
                  className="p-1.5 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <GripVertical className="w-4 h-4 text-muted-foreground hidden sm:block" />
                <button
                  onClick={() => moveTask(displayIdx, 'down')}
                  disabled={displayIdx === displayTasks.length - 1}
                  className="p-1.5 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => moveTaskToEdge(displayIdx, 'bottom')}
                  disabled={displayIdx === displayTasks.length - 1}
                  className="p-1.5 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  title="Move to bottom"
                >
                  <ChevronsDown className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                {editingId === task?.id ? (
                  <div className="space-y-3">
                    <Input
                      value={editName ?? ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName((e?.target?.value ?? '').slice(0, 100))}
                      className="bg-secondary/50 border-border"
                      maxLength={100}
                    />
                    <ColorPicker value={editColor} onChange={setEditColor} size="sm" />
                    {showEditPicker && (
                      <div className="bg-secondary/30 rounded-xl p-4 flex justify-center">
                        <TimePicker
                          onSelect={(s: number) => setEditDuration(s)}
                          initialHours={Math.floor((editDuration ?? 300) / 3600)}
                          initialMinutes={Math.floor(((editDuration ?? 300) % 3600) / 60)}
                          initialSeconds={(editDuration ?? 300) % 60}
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setShowEditPicker(false); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-foreground font-medium break-words">{task?.name ?? 'Task'}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        Duration: {formatDuration(task?.durationSeconds ?? 0)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Cumulative: {formatDuration(task?.cumulativeSeconds ?? 0)}
                      </span>
                      {getTaskEndTime(task) && (
                        <span className="text-xs text-primary/80 font-medium">
                          🔔 {getTaskEndTime(task)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {editingId !== task?.id && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(task)}
                    className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDeleteTask?.(task?.id)}
                    className="p-2 rounded-lg hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Start session buttons */}
      {(tasks?.length ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 gap-3 pt-4">
          <Button
            onClick={() => {
              onSessionModeChange('continuous');
              onStartSession();
            }}
            size="lg"
            className="gradient-primary hover:opacity-90 text-primary-foreground px-4 py-6 text-sm font-semibold rounded-xl shadow-lg glow-primary"
          >
            <Infinity className="w-5 h-5 mr-1.5 flex-shrink-0" />
            Continuous
          </Button>
          <Button
            onClick={() => {
              onSessionModeChange('sprint');
              onStartSession();
            }}
            size="lg"
            className="gradient-primary hover:opacity-90 text-primary-foreground px-4 py-6 text-sm font-semibold rounded-xl shadow-lg glow-primary"
          >
            <Zap className="w-5 h-5 mr-1.5 flex-shrink-0" />
            Sprint
          </Button>
        </motion.div>
      )}

      {/* Clear all confirmation modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowClearConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="glass-card rounded-2xl p-6 max-w-sm mx-4 space-y-4"
              style={{ boxShadow: 'var(--shadow-lg)' }}
            >
              <h3 className="font-display text-lg font-semibold text-foreground">Clear all tasks?</h3>
              <p className="text-sm text-muted-foreground">This will delete all {(tasks?.length ?? 0)} task{(tasks?.length ?? 0) !== 1 ? 's' : ''}. This action cannot be undone.</p>
              <div className="flex gap-3 justify-end">
                <Button
                  onClick={() => setShowClearConfirm(false)}
                  variant="ghost"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleClearAll}
                  size="sm"
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                >
                  Clear all
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
