'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Crosshair,
  Flag,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ColorPicker } from './color-picker';
import { TimePicker } from './time-picker';
import {
  TASK_COLORS,
  Task,
  TaskColorId,
  SessionState,
  getTaskColorHex,
} from '@/lib/types';
import { formatDuration, formatTime } from '@/lib/timer-utils';

const PAD_TOP = 56;
const PAD_BOTTOM = 72;
const RAIL_X = 88;
const RAIL_WIDTH = 3;
const RAIL_CENTER = RAIL_X + RAIL_WIDTH / 2;
const CONNECTOR_LENGTH = 28;
const LABEL_LEFT = RAIL_X + CONNECTOR_LENGTH + 10;
const MIN_LABEL_GAP = 84;
const EDIT_LABEL_GAP = 210;
const EDIT_PICKER_GAP = 350;
const MIN_PIXELS_PER_MINUTE = 2;
const MAX_PIXELS_PER_MINUTE = 10;
const DEFAULT_PIXELS_PER_MINUTE = 5;
const MIN_RAIL_HEIGHT = 320;
const TIMELINE_SCALE_KEY = 'countdowndo-timeline-scale';
const ORANGE = TASK_COLORS[0].hex;
const GREY = 'hsl(var(--muted-foreground))';

type TimelineMode = 'planning' | 'live';

export interface SessionTimelineProps {
  mode: TimelineMode;
  tasks: Task[];
  sessionState?: SessionState;
  sessionTotalSeconds?: number;
  elapsedSeconds?: number;
  sessionStartTimestamp?: number | null;
  pausedElapsed?: number;
  planningStartTime?: string | null;
  getRemainingTime?: (task: Task) => number;
  onMarkDone?: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onEditTask: (id: string, name: string, durationSeconds: number, color?: TaskColorId) => void;
  onReorder: (tasks: Task[]) => void;
}

interface LaidOutTask {
  task: Task;
  dotY: number;
  labelY: number;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function SessionTimeline({
  mode,
  tasks,
  sessionState = 'idle',
  sessionTotalSeconds = 0,
  elapsedSeconds = 0,
  sessionStartTimestamp = null,
  pausedElapsed = 0,
  planningStartTime = null,
  getRemainingTime,
  onMarkDone,
  onDeleteTask,
  onEditTask,
  onReorder,
}: SessionTimelineProps) {
  const isLive = mode === 'live';
  const isRunning = sessionState === 'running';
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDuration, setEditDuration] = useState(300);
  const [editColor, setEditColor] = useState<TaskColorId>('orange');
  const [showEditPicker, setShowEditPicker] = useState(false);
  const [arrivingIds, setArrivingIds] = useState<Set<string>>(new Set());
  const [followNow, setFollowNow] = useState(true);
  const [pixelsPerMinute, setPixelsPerMinute] = useState(DEFAULT_PIXELS_PER_MINUTE);
  const announcedIds = useRef<Set<string>>(new Set());
  const arrivalTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    try {
      const savedValue = localStorage.getItem(TIMELINE_SCALE_KEY);
      if (!savedValue) return;
      const saved = Number(savedValue);
      if (Number.isFinite(saved)) {
        setPixelsPerMinute(
          Math.min(MAX_PIXELS_PER_MINUTE, Math.max(MIN_PIXELS_PER_MINUTE, saved)),
        );
      }
    } catch {}
  }, []);

  const updatePixelsPerMinute = (value: number) => {
    const next = Math.min(
      MAX_PIXELS_PER_MINUTE,
      Math.max(MIN_PIXELS_PER_MINUTE, value),
    );
    setPixelsPerMinute(next);
    try {
      localStorage.setItem(TIMELINE_SCALE_KEY, String(next));
    } catch {}
  };

  const totalSeconds = useMemo(() => {
    if (isLive && sessionTotalSeconds > 0) return sessionTotalSeconds;
    return tasks[tasks.length - 1]?.cumulativeSeconds ?? 0;
  }, [isLive, sessionTotalSeconds, tasks]);

  const railHeight = Math.max(
    MIN_RAIL_HEIGHT,
    (totalSeconds / 60) * pixelsPerMinute,
  );

  const anchorMs = useMemo(() => {
    if (isLive) {
      if (sessionStartTimestamp && sessionStartTimestamp > 0) {
        return sessionStartTimestamp - pausedElapsed * 1000;
      }
      return Date.now() - elapsedSeconds * 1000;
    }

    if (!planningStartTime) return null;
    const [hours, minutes] = planningStartTime.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  }, [
    elapsedSeconds,
    isLive,
    pausedElapsed,
    planningStartTime,
    sessionStartTimestamp,
  ]);

  const tickStep = useMemo(() => {
    const minutes = totalSeconds / 60;
    if (minutes <= 30) return 300;
    if (minutes <= 120) return 900;
    if (minutes <= 300) return 1800;
    return 3600;
  }, [totalSeconds]);

  const ticks = useMemo(() => {
    const values: number[] = [];
    for (let seconds = tickStep; seconds < totalSeconds; seconds += tickStep) {
      values.push(seconds);
    }
    return values;
  }, [tickStep, totalSeconds]);

  const nowY = isLive && totalSeconds > 0
    ? Math.min(1, Math.max(0, elapsedSeconds / totalSeconds)) * railHeight
    : 0;
  const sessionRemaining = totalSeconds - elapsedSeconds;
  const isOvertime = isLive && sessionRemaining < 0;

  const laidOutTasks = useMemo<LaidOutTask[]>(() => {
    let previousLabelY = -Infinity;

    return tasks.map((task) => {
      const dotY = totalSeconds > 0
        ? Math.min(1, Math.max(0, (task.cumulativeSeconds ?? 0) / totalSeconds)) * railHeight
        : 0;
      const gap = editingTaskId === task.id
        ? (showEditPicker ? EDIT_PICKER_GAP : EDIT_LABEL_GAP)
        : MIN_LABEL_GAP;
      const labelY = Math.max(dotY, previousLabelY + gap);
      previousLabelY = labelY;
      return { task, dotY, labelY };
    });
  }, [editingTaskId, railHeight, showEditPicker, tasks, totalSeconds]);

  const lastTask = laidOutTasks[laidOutTasks.length - 1];
  const editingHeight = editingTaskId && showEditPicker ? 300 : editingTaskId ? 170 : 76;
  const innerHeight = PAD_TOP + Math.max(
    railHeight,
    lastTask ? lastTask.labelY + editingHeight : 0,
  ) + PAD_BOTTOM;

  useEffect(() => {
    if (!isLive) return;

    tasks.forEach((task) => {
      if (task.isDone || task.cumulativeSeconds <= elapsedSeconds) {
        announcedIds.current.add(task.id);
      }
    });
    // The initial pass prevents a view switch or refresh from replaying old arrivals.
    // New tasks are still announced when their deadline is reached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLive) return;

    tasks.forEach((task) => {
      if (task.isDone || task.cumulativeSeconds > elapsedSeconds) return;
      if (announcedIds.current.has(task.id)) return;

      announcedIds.current.add(task.id);
      setArrivingIds((current) => {
        const next = new Set(current);
        next.add(task.id);
        return next;
      });

      const timeout = setTimeout(() => {
        setArrivingIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
        arrivalTimeouts.current.delete(task.id);
      }, 1700);
      arrivalTimeouts.current.set(task.id, timeout);
    });
  }, [elapsedSeconds, isLive, tasks]);

  useEffect(() => {
    return () => {
      arrivalTimeouts.current.forEach((timeout) => clearTimeout(timeout));
    };
  }, []);

  useEffect(() => {
    if (!isLive || !isRunning || !followNow) return;
    const element = scrollRef.current;
    if (!element) return;

    const target = Math.max(0, PAD_TOP + nowY - element.clientHeight * 0.33);
    if (Math.abs(element.scrollTop - target) > 48) {
      element.scrollTop = target;
    }
  }, [followNow, isLive, isRunning, nowY]);

  const startEditing = (task: Task) => {
    setEditingTaskId(task.id);
    setEditName(task.name ?? '');
    setEditDuration(task.durationSeconds ?? 300);
    setEditColor(task.color ?? 'orange');
    setShowEditPicker(false);
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditName('');
    setEditDuration(300);
    setEditColor('orange');
    setShowEditPicker(false);
  };

  const saveEdit = () => {
    if (!editingTaskId || !editName.trim()) return;
    onEditTask(editingTaskId, editName.trim(), editDuration, editColor);
    cancelEditing();
  };

  const moveTask = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tasks.length) return;
    const next = [...tasks];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    onReorder(next);
  };

  const moveTaskToEdge = (index: number, edge: 'top' | 'bottom') => {
    const targetIndex = edge === 'top' ? 0 : tasks.length - 1;
    if (targetIndex === index) return;
    const next = [...tasks];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    onReorder(next);
  };

  const handleDrop = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const from = dragItem.current;
    const to = dragOverItem.current;
    dragItem.current = null;
    dragOverItem.current = null;
    if (from === to) return;

    const next = [...tasks];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onReorder(next);
  };

  const handleDelete = (taskId: string) => {
    if (editingTaskId === taskId) cancelEditing();
    onDeleteTask(taskId);
  };

  const handleRecenter = () => {
    setFollowNow(true);
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = Math.max(0, PAD_TOP + nowY - element.clientHeight * 0.33);
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="glass-card rounded-2xl text-center text-muted-foreground py-12" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <p>{isLive ? 'No tasks in session. Add one to continue.' : 'Add a task to see the timeline preview.'}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-secondary/20 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Timeline scale</p>
          <p className="text-[10px] text-muted-foreground">Adjust line length to reduce scrolling</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updatePixelsPerMinute(pixelsPerMinute - 1)}
            disabled={pixelsPerMinute <= MIN_PIXELS_PER_MINUTE}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            title="Shorten timeline"
            aria-label="Shorten timeline"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="range"
            min={MIN_PIXELS_PER_MINUTE}
            max={MAX_PIXELS_PER_MINUTE}
            step={1}
            value={pixelsPerMinute}
            onChange={(event) => updatePixelsPerMinute(Number(event.target.value))}
            className="h-1.5 w-24 cursor-pointer accent-orange-500 sm:w-32"
            aria-label="Timeline line length"
            aria-valuetext={`${pixelsPerMinute} pixels per minute`}
          />
          <button
            type="button"
            onClick={() => updatePixelsPerMinute(pixelsPerMinute + 1)}
            disabled={pixelsPerMinute >= MAX_PIXELS_PER_MINUTE}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            title="Lengthen timeline"
            aria-label="Lengthen timeline"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-right font-mono text-[10px] text-muted-foreground">
            {pixelsPerMinute}px/m
          </span>
        </div>
      </div>
      <div
        ref={scrollRef}
        onWheel={() => isLive && setFollowNow(false)}
        onTouchMove={() => isLive && setFollowNow(false)}
        className="glass-card relative max-h-[70vh] min-h-[340px] overflow-x-hidden overflow-y-auto rounded-2xl"
        style={{ boxShadow: 'var(--shadow-md)' }}
      >
        <div className="relative w-full" style={{ height: innerHeight }}>
          <div
            className="absolute rounded-full"
            style={{
              left: RAIL_X,
              top: PAD_TOP,
              width: RAIL_WIDTH,
              height: railHeight,
              background: 'hsl(var(--border))',
            }}
          />

          {isLive ? (
            <motion.div
              className="absolute rounded-full"
              initial={false}
              animate={{ top: PAD_TOP + nowY, height: Math.max(0, railHeight - nowY) }}
              transition={{ duration: 0.25, ease: 'linear' }}
              style={{
                left: RAIL_X,
                width: RAIL_WIDTH,
                background: ORANGE,
                boxShadow: '0 0 10px rgba(249, 115, 22, 0.45)',
              }}
            />
          ) : (
            <div
              className="absolute rounded-full"
              style={{
                left: RAIL_X,
                top: PAD_TOP,
                width: RAIL_WIDTH,
                height: railHeight,
                background: ORANGE,
                boxShadow: '0 0 10px rgba(249, 115, 22, 0.35)',
              }}
            />
          )}

          <div
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500"
            style={{ left: RAIL_CENTER, top: PAD_TOP }}
          />
          <div
            className="absolute flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
            style={{ left: 12, top: PAD_TOP - 20 }}
          >
            <span>{anchorMs !== null ? formatClock(anchorMs) : 'Start'}</span>
          </div>

          <div
            className="absolute flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
            style={{ left: 12, top: PAD_TOP + railHeight + 10 }}
          >
            <Flag className="h-3.5 w-3.5 text-primary" />
            <span>
              {anchorMs !== null
                ? formatClock(anchorMs + totalSeconds * 1000)
                : formatDuration(totalSeconds)}
            </span>
          </div>

          {ticks.map((tick) => {
            const y = PAD_TOP + (tick / totalSeconds) * railHeight;
            return (
              <React.Fragment key={tick}>
                <div
                  className="absolute h-px w-4 bg-border"
                  style={{ left: RAIL_X - 6, top: y }}
                />
                <span
                  className="absolute w-[68px] text-right font-mono text-[10px] text-muted-foreground/70"
                  style={{ left: 10, top: y - 7 }}
                >
                  {anchorMs !== null ? formatClock(anchorMs + tick * 1000) : `+${formatDuration(tick)}`}
                </span>
              </React.Fragment>
            );
          })}

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {laidOutTasks.map(({ task, dotY, labelY }) => {
              const done = task.isDone;
              const arriving = arrivingIds.has(task.id);
              const color = done ? GREY : ORANGE;
              return (
                <motion.line
                  key={`connector-${task.id}`}
                  x1={RAIL_CENTER}
                  x2={LABEL_LEFT}
                  y1={PAD_TOP + dotY}
                  y2={PAD_TOP + labelY + 23}
                  initial={false}
                  animate={{
                    x1: RAIL_CENTER,
                    x2: LABEL_LEFT,
                    y1: PAD_TOP + dotY,
                    y2: PAD_TOP + labelY + 23,
                    stroke: color,
                    strokeOpacity: arriving ? [0.9, 0.2, 0.9, 0.2, 0.9] : done ? 0.45 : 0.9,
                    strokeWidth: arriving ? [1.5, 3, 1.5] : 1.5,
                  }}
                  transition={{ duration: arriving ? 0.9 : 0.35, ease: 'easeOut' }}
                />
              );
            })}
          </svg>

          {isLive && (
            <motion.div
              className="absolute z-30"
              initial={false}
              animate={{ top: PAD_TOP + nowY }}
              transition={{ duration: 0.25, ease: 'linear' }}
              style={{ left: RAIL_CENTER }}
            >
              <div className="relative -translate-x-1/2 -translate-y-1/2">
                {isRunning && (
                  <motion.span
                    className="absolute inset-0 rounded-full bg-orange-500/40"
                    animate={{ scale: [1, 2], opacity: [0.6, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                <div
                  className={`h-3.5 w-3.5 rounded-full border-2 border-background ${
                    isRunning ? 'bg-orange-500' : 'bg-muted-foreground'
                  }`}
                  style={isRunning ? { boxShadow: '0 0 12px rgba(249, 115, 22, 0.8)' } : undefined}
                />
              </div>
              <div className="absolute right-3 top-[-18px] whitespace-nowrap text-right">
                <div
                  className={`rounded-lg border px-2 py-1 font-mono text-[10px] leading-tight shadow-sm ${
                    isOvertime
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-border/60 bg-card text-foreground'
                  }`}
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  <div className="font-bold">{formatTime(Math.max(0, elapsedSeconds))}</div>
                  <div className={isOvertime ? '' : 'text-muted-foreground'}>
                    {sessionState === 'paused'
                      ? 'Paused'
                      : isOvertime
                        ? `${formatTime(Math.abs(sessionRemaining))} over`
                        : `${formatTime(sessionRemaining)} left`}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {laidOutTasks.map(({ task, dotY, labelY }, index) => {
            const done = task.isDone;
            const arriving = arrivingIds.has(task.id);
            const passed = isLive && !done && task.cumulativeSeconds <= elapsedSeconds;
            const editing = editingTaskId === task.id;
            const remaining = getRemainingTime
              ? getRemainingTime(task)
              : task.cumulativeSeconds - elapsedSeconds;
            const overdue = isLive && !done && remaining < 0;

            return (
              <React.Fragment key={task.id}>
                <motion.div
                  className="absolute z-20"
                  initial={false}
                  animate={{ top: PAD_TOP + dotY }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  style={{ left: RAIL_CENTER }}
                >
                  <div className="relative h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2">
                    {passed && !arriving && (
                      <motion.span
                        className="absolute inset-0 rounded-full bg-orange-500/35"
                        animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                    <AnimatePresence>
                      {arriving && [0, 1, 2].map((burst) => (
                        <motion.span
                          key={`burst-${burst}`}
                          className="absolute inset-0 rounded-full border-2 border-orange-500"
                          initial={{ scale: 0.7, opacity: 0.9 }}
                          animate={{ scale: 3.2, opacity: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 1.1, delay: burst * 0.16, ease: 'easeOut' }}
                        />
                      ))}
                    </AnimatePresence>
                    <motion.div
                      className="h-3.5 w-3.5 rounded-full border-2 border-background"
                      initial={false}
                      animate={{
                        backgroundColor: done ? GREY : ORANGE,
                        scale: arriving ? [1, 1.45, 1] : 1,
                      }}
                      transition={{ duration: arriving ? 0.6 : 0.3 }}
                      style={done ? undefined : { boxShadow: '0 0 8px rgba(249, 115, 22, 0.6)' }}
                    />
                  </div>
                </motion.div>

                <AnimatePresence initial={false}>
                  <motion.div
                    key={`label-${task.id}`}
                    className="group absolute z-20"
                    initial={{ opacity: 0 }}
                    animate={{
                      top: PAD_TOP + labelY,
                      x: arriving ? [0, 4, 0] : 0,
                      opacity: 1,
                    }}
                    exit={{ opacity: 0, x: -32 }}
                    transition={{
                      top: { duration: 0.35, ease: 'easeOut' },
                      x: { duration: 0.5 },
                      opacity: { duration: 0.2 },
                    }}
                    style={{ left: LABEL_LEFT, right: 12 }}
                    draggable={!editing}
                    onDragStart={() => { dragItem.current = index; }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      dragOverItem.current = index;
                    }}
                    onDrop={handleDrop}
                  >
                    <div
                      className={`glass-card overflow-hidden rounded-xl transition-opacity ${done ? 'opacity-60' : ''}`}
                      style={{
                        boxShadow: 'var(--shadow-sm)',
                        borderLeft: `3px solid ${getTaskColorHex(task.color)}`,
                      }}
                    >
                      {editing ? (
                        <div className="space-y-2 p-3">
                          <Input
                            value={editName}
                            onChange={(event) => setEditName(event.target.value.slice(0, 100))}
                            className="h-8 bg-secondary/50 border-border text-sm"
                            maxLength={100}
                            autoFocus
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') saveEdit();
                              if (event.key === 'Escape') cancelEditing();
                            }}
                          />
                          <ColorPicker value={editColor} onChange={setEditColor} size="sm" />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setShowEditPicker((current) => !current)}
                              className="rounded-lg bg-secondary/50 px-2 py-1 text-xs transition-colors hover:bg-secondary"
                            >
                              <span className="font-mono">{formatDuration(editDuration)}</span>
                            </button>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={!editName.trim()}
                              className="rounded-lg bg-green-500/20 p-1.5 text-green-600 transition-colors hover:bg-green-500/30 disabled:opacity-40 dark:text-green-400"
                              title="Save changes"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditing}
                              className="rounded-lg bg-destructive/15 p-1.5 text-destructive transition-colors hover:bg-destructive/25"
                              title="Cancel editing"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {showEditPicker && (
                            <div className="flex justify-center rounded-xl bg-secondary/30 p-2">
                              <TimePicker
                                onSelect={setEditDuration}
                                initialHours={Math.floor(editDuration / 3600)}
                                initialMinutes={Math.floor((editDuration % 3600) / 60)}
                                initialSeconds={editDuration % 60}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5 px-3 py-2.5">
                          <div className="flex items-start gap-1.5">
                            <p className={`min-w-0 flex-1 break-words text-sm font-medium leading-tight ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                              {task.name || 'Task'}
                            </p>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => moveTaskToEdge(index, 'top')}
                                disabled={index === 0}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-20"
                                title="Move to top"
                                aria-label="Move to top"
                              >
                                <ChevronsUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveTask(index, 'up')}
                                disabled={index === 0}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-20"
                                title="Move up"
                                aria-label="Move up"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveTask(index, 'down')}
                                disabled={index === tasks.length - 1}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-20"
                                title="Move down"
                                aria-label="Move down"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveTaskToEdge(index, 'bottom')}
                                disabled={index === tasks.length - 1}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-20"
                                title="Move to bottom"
                                aria-label="Move to bottom"
                              >
                                <ChevronsDown className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{formatDuration(task.durationSeconds)}</span>
                            {anchorMs !== null && (
                              <span className="flex items-center gap-0.5 font-medium text-primary/80">
                                <Bell className="h-3 w-3" />
                                {formatClock(anchorMs + task.cumulativeSeconds * 1000)}
                              </span>
                            )}
                            {isLive && !done && (
                              <span className={`font-mono font-bold ${overdue ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                                {formatTime(remaining)}
                              </span>
                            )}
                            {isLive && done && (
                              <span className="font-medium text-green-600 dark:text-green-400">Done</span>
                            )}
                            <span className="ml-auto flex shrink-0 items-center gap-1">
                              {isLive && (
                                <button
                                  type="button"
                                  onClick={() => onMarkDone?.(task.id)}
                                  className={`rounded-lg p-1.5 transition-colors ${done ? 'bg-green-500/30 text-green-700 hover:bg-green-500/40 dark:text-green-300' : 'bg-green-500/15 text-green-600 hover:bg-green-500/25 dark:text-green-400'}`}
                                  title={done ? 'Uncheck task' : 'Mark done'}
                                  aria-label={done ? 'Uncheck task' : 'Mark done'}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEditing(task)}
                                className="rounded-lg bg-primary/15 p-1.5 text-primary transition-colors hover:bg-primary/25"
                                title="Edit task"
                                aria-label="Edit task"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(task.id)}
                                className="rounded-lg bg-destructive/15 p-1.5 text-destructive transition-colors hover:bg-destructive/25"
                                title="Remove task"
                                aria-label="Remove task"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {isLive && !followNow && (
        <Button
          type="button"
          size="sm"
          onClick={handleRecenter}
          className="absolute bottom-3 right-3 z-40 rounded-full shadow-md"
        >
          <Crosshair className="mr-1.5 h-3.5 w-3.5" />
          Re-center
        </Button>
      )}
    </div>
  );
}
