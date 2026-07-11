'use client';

import React, { useState, useMemo } from 'react';
import { Task, SessionState, SessionMode, TaskOrder, TaskColorId, getTaskColorHex } from '@/lib/types';
import { ColorPicker } from './color-picker';
import { formatTime, formatDuration } from '@/lib/timer-utils';
import { Pause, Play, Square, Plus, X, GripVertical, Check, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Pencil, Infinity, Zap, ArrowUpDown, Trash2, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimePicker } from './time-picker';
import { motion, AnimatePresence } from 'framer-motion';

interface ActiveSessionProps {
  tasks: Task[];
  sessionState: SessionState;
  sessionMode: SessionMode;
  sessionTotalSeconds: number;
  elapsedSeconds: number;
  sessionStartTimestamp: number;
  pausedElapsed: number;
  taskOrder: TaskOrder;
  onToggleOrder: () => void;
  getRemainingTime: (task: Task) => number;
  getProgress: (task: Task) => number;
  onMarkDone: (id: string) => void;
  onPause: () => void;
  onStop: () => void;
  onAddTask: (name: string, durationSeconds: number, position?: 'top' | 'bottom', color?: TaskColorId) => void;
  onDeleteTask: (id: string) => void;
  onEditTask: (id: string, name: string, durationSeconds: number, color?: TaskColorId) => void;
  onReorder: (tasks: Task[]) => void;
  onOpenTaskBank: () => void;
}

export function ActiveSession({
  tasks,
  sessionState,
  sessionMode,
  sessionTotalSeconds,
  elapsedSeconds,
  sessionStartTimestamp,
  pausedElapsed,
  taskOrder,
  onToggleOrder,
  getRemainingTime,
  getProgress,
  onMarkDone,
  onPause,
  onStop,
  onAddTask,
  onDeleteTask,
  onEditTask,
  onReorder,
  onOpenTaskBank,
}: ActiveSessionProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDuration, setNewTaskDuration] = useState(300);
  const [showPicker, setShowPicker] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDuration, setEditDuration] = useState(300);
  const [showEditPicker, setShowEditPicker] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [newTaskColor, setNewTaskColor] = useState<TaskColorId>('orange');
  const [editColor, setEditColor] = useState<TaskColorId>('orange');
  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);
  // Track known task IDs to prevent entrance animation flicker on existing tasks
  const knownTaskIds = React.useRef<Set<string>>(new Set((tasks ?? []).map((t: Task) => t?.id).filter(Boolean)));
  React.useEffect(() => {
    // After render, mark all current task IDs as known
    const timer = setTimeout(() => {
      (tasks ?? []).forEach((t: Task) => { if (t?.id) knownTaskIds.current.add(t.id); });
    }, 400); // after entrance animation completes
    return () => clearTimeout(timer);
  }, [tasks]);

  const handleAdd = (position: 'top' | 'bottom' = 'bottom') => {
    const name = (newTaskName ?? '').trim();
    if (!name) return;
    onAddTask?.(name, newTaskDuration ?? 300, position, newTaskColor);
    setNewTaskName('');
    setNewTaskDuration(300);
    setShowAddForm(false);
    setShowPicker(false);
  };

  // Compute the real-world start time of the session (accounting for pauses)
  const sessionRealStartMs = useMemo(() => {
    // The effective "zero elapsed" moment in real time
    if (sessionStartTimestamp) {
      return sessionStartTimestamp - pausedElapsed * 1000;
    }
    // When paused, sessionStartTimestamp is null; use current time - elapsed
    return Date.now() - elapsedSeconds * 1000;
  }, [sessionStartTimestamp, pausedElapsed, elapsedSeconds]);

  const getTaskEndTime = (task: Task): string => {
    const endMs = sessionRealStartMs + (task?.cumulativeSeconds ?? 0) * 1000;
    const d = new Date(endMs);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Use sessionTotalSeconds as the source of truth for session duration
  const sessionEndTimeStr = useMemo(() => {
    const endMs = sessionRealStartMs + sessionTotalSeconds * 1000;
    const d = new Date(endMs);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  }, [sessionRealStartMs, sessionTotalSeconds]);

  const startEditing = (task: Task) => {
    setEditingTaskId(task?.id);
    setEditName(task?.name ?? '');
    setEditDuration(task?.durationSeconds ?? 300);
    setEditColor(task?.color ?? 'orange');
    setShowEditPicker(true);
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditName('');
    setEditDuration(300);
    setShowEditPicker(false);
  };

  const saveEdit = () => {
    if (!editingTaskId || !(editName ?? '').trim()) return;
    onEditTask?.(editingTaskId, (editName ?? '').trim(), editDuration, editColor);
    cancelEditing();
  };

  const isAsc = taskOrder === 'asc';
  const displayTasks = isAsc ? [...(tasks ?? [])].reverse() : (tasks ?? []);
  const toRealIdx = (displayIdx: number) => isAsc ? (tasks?.length ?? 0) - 1 - displayIdx : displayIdx;

  const moveTask = (displayIdx: number, direction: 'up' | 'down') => {
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
    const targetIdx = isAsc
      ? (edge === 'top' ? (tasks?.length ?? 1) - 1 : 0)
      : (edge === 'top' ? 0 : (tasks?.length ?? 1) - 1);
    if (realIdx === targetIdx) return;
    const newTasks = [...(tasks ?? [])];
    const [moved] = newTasks.splice(realIdx, 1);
    if (moved) newTasks.splice(targetIdx, 0, moved);
    onReorder?.(newTasks);
  };

  const handleDragStart = (displayIdx: number) => { dragItem.current = displayIdx; };
  const handleDragOver = (e: React.DragEvent, displayIdx: number) => { e?.preventDefault?.(); dragOverItem.current = displayIdx; };
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

  const handleClearAll = () => {
    (tasks ?? []).forEach((task: Task) => {
      onDeleteTask?.(task?.id);
    });
    setShowClearConfirm(false);
  };

  return (
    <div className="space-y-6">
      {/* Session mode badge */}
      <div className="flex items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
          sessionMode === 'continuous'
            ? 'bg-primary/10 text-primary border-primary/20'
            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }`}>
          {sessionMode === 'continuous' ? <Infinity className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          {sessionMode === 'continuous' ? 'Continuous' : 'Sprint'} session
        </div>
      </div>

      {/* Session controls */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={onPause}
            variant="outline"
            className="border-primary text-primary hover:bg-primary/10"
          >
            {sessionState === 'paused' ? (
              <><Play className="w-4 h-4 mr-2" /> Resume</>
            ) : (
              <><Pause className="w-4 h-4 mr-2" /> Pause All</>
            )}
          </Button>
          <Button
            onClick={onStop}
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10"
          >
            <Square className="w-4 h-4 mr-2" /> Stop Session
          </Button>
          {(tasks?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="text-xs px-3 py-2 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-sm text-muted-foreground whitespace-nowrap">
            Elapsed: {formatTime(elapsedSeconds ?? 0)}
          </span>
          <span className="text-sm text-primary font-medium whitespace-nowrap">
            Session ends: {sessionEndTimeStr}
          </span>
          <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
            <Button
              onClick={() => setShowAddForm(!showAddForm)}
              size="sm"
              variant="ghost"
              className="text-primary hover:bg-primary/10"
            >
              <Plus className="w-4 h-4 mr-1" /> Add Task
            </Button>
            <Button
              onClick={onOpenTaskBank}
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              title="Add tasks from your Task Bank"
            >
              <Archive className="w-4 h-4 mr-1" /> From Task Bank
            </Button>
          </div>
        </div>
      </div>

      {/* Add task form mid-session */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card rounded-2xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-md)' }}>
              <Input
                placeholder="Task name"
                value={newTaskName ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTaskName((e?.target?.value ?? '').slice(0, 100))}
                className="bg-secondary/50 border-border"
                maxLength={100}
              />
              <div className="flex items-center gap-3">
                <ColorPicker value={newTaskColor} onChange={setNewTaskColor} size="sm" />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => setShowPicker(!showPicker)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-lg text-sm hover:bg-secondary transition-colors"
                >
                  <span className="font-mono">{formatDuration(newTaskDuration ?? 300)}</span>
                </button>
                <Button onClick={() => handleAdd('bottom')} size="sm" disabled={!(newTaskName ?? '').trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground" title="Add to end (do last)">
                  <Plus className="w-4 h-4 mr-1" /> Add to Bottom
                </Button>
                <Button onClick={() => handleAdd('top')} size="sm" disabled={!(newTaskName ?? '').trim()} variant="outline" className="border-primary text-primary hover:bg-primary/10" title="Add to start (do first)">
                  <Plus className="w-4 h-4 mr-1" /> Add to Top
                </Button>
              </div>
              {showPicker && (
                <div className="bg-secondary/30 rounded-xl p-4 flex justify-center">
                  <TimePicker onSelect={(s: number) => setNewTaskDuration(s)} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task list with timers */}
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
          </div>
        )}
        <AnimatePresence initial={false}>
          {displayTasks.map((task: Task, displayIdx: number) => {
            const remaining = getRemainingTime?.(task) ?? 0;
            const progress = getProgress?.(task) ?? 0;
            const isOvertime = remaining < 0 && !task?.isDone;
            const isDone = task?.isDone ?? false;

            return (
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
                className={`glass-card glass-card-hover rounded-xl overflow-hidden group transition-all cursor-grab active:cursor-grabbing ${
                  isDone ? 'opacity-50' : ''
                }`}
                style={{ boxShadow: 'var(--shadow-md)', borderLeft: `3px solid ${getTaskColorHex(task?.color)}` }}
              >
                {/* Progress bar at top */}
                <div className="h-1 w-full bg-secondary/30">
                  <div
                    className={`h-full transition-all duration-500 ease-linear rounded-r-full ${
                      isDone
                        ? 'bg-green-500'
                        : isOvertime
                        ? 'bg-red-500'
                        : 'bg-primary'
                    }`}
                    style={{ width: isDone ? '100%' : isOvertime ? '0%' : `${Math.max(0, (1 - progress) * 100)}%` }}
                  />
                </div>

                <div className="px-4 py-3 flex items-center gap-3">
                  {/* Reorder controls */}
                  <div className="flex flex-col items-center gap-0 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); moveTaskToEdge(displayIdx, 'top'); }}
                      disabled={displayIdx === 0}
                      className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                      aria-label="Move to top"
                    >
                      <ChevronsUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); moveTask(displayIdx, 'up'); }}
                      disabled={displayIdx === 0}
                      className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                      aria-label="Move task up"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity hidden sm:block" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); moveTask(displayIdx, 'down'); }}
                      disabled={displayIdx === displayTasks.length - 1}
                      className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                      aria-label="Move task down"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); moveTaskToEdge(displayIdx, 'bottom'); }}
                      disabled={displayIdx === displayTasks.length - 1}
                      className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                      aria-label="Move to bottom"
                    >
                      <ChevronsDown className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Task content */}
                  {editingTaskId === task?.id ? (
                    <div className="flex-1 min-w-0 space-y-2">
                      <Input
                        value={editName ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName((e?.target?.value ?? '').slice(0, 100))}
                        className="bg-secondary/50 border-border h-8 text-sm"
                        maxLength={100}
                        autoFocus
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') cancelEditing();
                        }}
                      />
                      <ColorPicker value={editColor} onChange={setEditColor} size="sm" />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowEditPicker(!showEditPicker)}
                          className="flex items-center gap-1.5 px-2 py-1 bg-secondary/50 rounded-lg text-xs hover:bg-secondary transition-colors"
                        >
                          <span className="font-mono">{formatDuration(editDuration ?? 300)}</span>
                        </button>
                        <button
                          onClick={saveEdit}
                          disabled={!(editName ?? '').trim()}
                          className="p-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors disabled:opacity-40"
                          title="Save changes"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1 rounded bg-destructive/20 hover:bg-destructive/30 text-destructive transition-colors"
                          title="Cancel editing"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {showEditPicker && (
                        <div className="bg-secondary/30 rounded-xl p-3 flex justify-center">
                          <TimePicker
                            onSelect={(s: number) => setEditDuration(s)}
                            initialHours={Math.floor((editDuration ?? 300) / 3600)}
                            initialMinutes={Math.floor(((editDuration ?? 300) % 3600) / 60)}
                            initialSeconds={(editDuration ?? 300) % 60}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      {/* Task name & metadata */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm break-words leading-tight ${
                          isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                        }`}>
                          {task?.name ?? 'Task'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(task?.durationSeconds ?? 0)}
                          </span>
                          <span className="text-xs text-primary/80 font-medium">
                            🔔 {getTaskEndTime(task)}
                          </span>
                        </div>
                      </div>

                      {/* Timer readout */}
                      <span
                        className={`font-mono text-base font-bold flex-shrink-0 ${
                          isDone
                            ? 'text-green-400'
                            : isOvertime
                            ? 'text-red-400'
                            : 'text-foreground'
                        }`}
                      >
                        {isDone ? '✓' : formatTime(remaining)}
                      </span>

                      {/* Action buttons — horizontal: edit, check, remove */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => startEditing(task)}
                          className="p-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary transition-colors"
                          title="Edit task"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onMarkDone?.(task?.id)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isDone
                              ? 'bg-green-500/30 text-green-300 hover:bg-green-500/40'
                              : 'bg-green-500/15 hover:bg-green-500/25 text-green-400'
                          }`}
                          title={isDone ? 'Uncheck task' : 'Mark done'}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTask?.(task?.id)}
                          className="p-1.5 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive transition-colors"
                          title={sessionMode === 'continuous' ? 'Remove task (marks as done)' : 'Delete task (shortens session)'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {(tasks?.length ?? 0) === 0 && (
        <div className="text-center text-muted-foreground py-12">
          <p>No tasks in session. Add one to continue.</p>
        </div>
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
              <p className="text-sm text-muted-foreground">This will delete all {(tasks?.length ?? 0)} task{(tasks?.length ?? 0) !== 1 ? 's' : ''} from the session. This action cannot be undone.</p>
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
