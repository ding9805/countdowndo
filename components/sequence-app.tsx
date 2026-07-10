'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Task, SavedListData, SessionState, SessionMode, TaskOrder, TaskColorId } from '@/lib/types';
import { generateId, recalculateCumulativeTimes, formatTime, formatDuration } from '@/lib/timer-utils';
import { playTimerSound } from '@/lib/use-timer-sound';
import { celebrate } from '@/lib/celebrate';
import { TaskInputPanel } from './task-input-panel';
import { ActiveSession } from './active-session';
import { SavedLists } from './saved-lists';
import { CompletionHistory } from './completion-history';
import { Dashboard } from './dashboard';
import { Timer, ListChecks, LogOut, LogIn, AlertTriangle, X, History, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';

const SYNC_INTERVAL = 3000;
const SAVE_DEBOUNCE = 1000;

export function SequenceApp() {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [savedLists, setSavedLists] = useState<SavedListData[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [pausedElapsed, setPausedElapsed] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [sessionMode, setSessionMode] = useState<SessionMode>('continuous');
  const [sessionTotalSeconds, setSessionTotalSeconds] = useState<number>(0);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'lists' | 'history' | 'dashboard'>('lists');
  const [taskOrder, setTaskOrder] = useState<TaskOrder>('desc');
  const [planningStartTime, setPlanningStartTime] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const soundPlayedRef = useRef<Set<string>>(new Set());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncRef = useRef<string>('');
  const isSavingRef = useRef(false);
  const sessionSavedToDbRef = useRef(false);

  // Load taskOrder from localStorage on mount + set initial planning start time
  useEffect(() => {
    try {
      const saved = localStorage.getItem('countdowndo-task-order');
      if (saved === 'asc' || saved === 'desc') setTaskOrder(saved);
    } catch {}
    // Default planning start time to current time
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setPlanningStartTime(`${hh}:${mm}`);
  }, []);

  const toggleTaskOrder = useCallback(() => {
    setTaskOrder(prev => {
      const next = prev === 'desc' ? 'asc' : 'desc';
      try { localStorage.setItem('countdowndo-task-order', next); } catch {}
      return next;
    });
  }, []);
  const initialLoadDone = useRef(false);

  // Fetch saved lists and active session on mount (only if logged in)
  useEffect(() => {
    if (isLoggedIn) {
      fetchSavedLists();
      loadActiveSession();
    } else {
      initialLoadDone.current = true;
    }
  }, [isLoggedIn]);

  // Cross-device sync polling (only if logged in and session active)
  useEffect(() => {
    if (isLoggedIn && (sessionState === 'running' || sessionState === 'paused')) {
      syncIntervalRef.current = setInterval(() => {
        pollActiveSession();
      }, SYNC_INTERVAL);
    } else {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    }
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [isLoggedIn, sessionState]);

  const fetchSavedLists = async () => {
    try {
      const res = await fetch('/api/saved-lists');
      if (!res.ok) return;
      const data = await res.json();
      setSavedLists(data ?? []);
    } catch (e: any) {
      console.error('Failed to fetch saved lists:', e);
    }
  };

  const loadActiveSession = async () => {
    try {
      const res = await fetch('/api/active-session');
      if (!res.ok) return;
      const data = await res.json();
      if (!data) {
        initialLoadDone.current = true;
        return;
      }

      const loadedTasks = (data.tasks as Task[]) ?? [];
      setTasks(loadedTasks);
      setSessionState(data.sessionState as SessionState);
      setSessionMode((data.sessionMode as SessionMode) ?? 'continuous');

      // Auto-heal: if sessionTotalSeconds is 0 but session is active with tasks,
      // derive it from the last task's cumulative (legacy/migration safety)
      let loadedTotal = data.sessionTotalSeconds ?? 0;
      if (loadedTotal <= 0 && loadedTasks.length > 0 && data.sessionState !== 'idle') {
        loadedTotal = loadedTasks[loadedTasks.length - 1]?.cumulativeSeconds ?? 0;
        console.warn('[loadActiveSession] sessionTotalSeconds was 0, derived from tasks:', loadedTotal);
      }
      setSessionTotalSeconds(loadedTotal);
      soundPlayedRef.current = new Set((data.soundPlayed as string[]) ?? []);

      if (data.sessionState === 'running') {
        setSessionStartTime(data.sessionStartMs);
        setPausedElapsed(data.pausedElapsed ?? 0);
      } else if (data.sessionState === 'paused') {
        setSessionStartTime(null);
        setPausedElapsed(data.pausedElapsed ?? 0);
      }

      lastSyncRef.current = JSON.stringify({
        tasks: loadedTasks,
        sessionState: data.sessionState,
        sessionStartMs: data.sessionStartMs,
        pausedElapsed: data.pausedElapsed,
        sessionMode: data.sessionMode,
        sessionTotalSeconds: data.sessionTotalSeconds ?? 0,
      });
      if (data.sessionState === 'running' || data.sessionState === 'paused') {
        sessionSavedToDbRef.current = true;
      }
      initialLoadDone.current = true;
    } catch (e: any) {
      console.error('Failed to load active session:', e);
      initialLoadDone.current = true;
    }
  };

  const pollActiveSession = async () => {
    if (isSavingRef.current || !isLoggedIn) return;
    try {
      const res = await fetch('/api/active-session');
      if (!res.ok) return;
      const data = await res.json();
      if (!data) {
        // Only reset to idle if we previously confirmed the session was saved to DB.
        // If save never succeeded (e.g. API error), don't kill the local session.
        if (sessionSavedToDbRef.current) {
          setSessionState('idle');
          setSessionStartTime(null);
          setPausedElapsed(0);
          setElapsedSeconds(0);
          soundPlayedRef.current = new Set();
          sessionSavedToDbRef.current = false;
        }
        return;
      }

      const remoteState = JSON.stringify({
        tasks: data.tasks,
        sessionState: data.sessionState,
        sessionStartMs: data.sessionStartMs,
        pausedElapsed: data.pausedElapsed,
        sessionMode: data.sessionMode,
        sessionTotalSeconds: data.sessionTotalSeconds ?? 0,
      });

      if (remoteState !== lastSyncRef.current) {
        lastSyncRef.current = remoteState;
        const loadedTasks = (data.tasks as Task[]) ?? [];
        setTasks(loadedTasks);
        setSessionMode((data.sessionMode as SessionMode) ?? 'continuous');

        // Auto-heal: derive sessionTotalSeconds from tasks if it's 0 but session is active
        let polledTotal = data.sessionTotalSeconds ?? 0;
        if (polledTotal <= 0 && loadedTasks.length > 0 && data.sessionState !== 'idle') {
          polledTotal = loadedTasks[loadedTasks.length - 1]?.cumulativeSeconds ?? 0;
        }
        setSessionTotalSeconds(polledTotal);
        soundPlayedRef.current = new Set((data.soundPlayed as string[]) ?? []);

        if (data.sessionState === 'running' && sessionState !== 'running') {
          setSessionState('running');
          setSessionStartTime(data.sessionStartMs);
          setPausedElapsed(data.pausedElapsed ?? 0);
        } else if (data.sessionState === 'paused' && sessionState !== 'paused') {
          setSessionState('paused');
          setSessionStartTime(null);
          setPausedElapsed(data.pausedElapsed ?? 0);
        } else if (data.sessionState === 'running') {
          setSessionStartTime(data.sessionStartMs);
          setPausedElapsed(data.pausedElapsed ?? 0);
        } else if (data.sessionState === 'paused') {
          setPausedElapsed(data.pausedElapsed ?? 0);
        }
      }
    } catch (e: any) {
      // Silent fail on poll
    }
  };

  const saveSessionToDb = useCallback((overrideTasks?: Task[], overrideState?: SessionState, overrideStartMs?: number | null, overridePausedElapsed?: number, overrideMode?: SessionMode, overrideTotalSeconds?: number) => {
    if (!isLoggedIn) return; // Don't save for guests
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      isSavingRef.current = true;
      try {
        const currentTasks = overrideTasks ?? tasks;
        const currentState = overrideState ?? sessionState;
        const currentStartMs = overrideStartMs !== undefined ? overrideStartMs : sessionStartTime;
        const currentPausedElapsed = overridePausedElapsed !== undefined ? overridePausedElapsed : pausedElapsed;
        const currentMode = overrideMode ?? sessionMode;
        const currentTotalSeconds = overrideTotalSeconds !== undefined ? overrideTotalSeconds : sessionTotalSeconds;

        const payload = {
          tasks: currentTasks,
          sessionState: currentState,
          sessionStartMs: currentStartMs ?? Date.now(),
          pausedElapsed: currentPausedElapsed,
          soundPlayed: Array.from(soundPlayedRef.current),
          sessionMode: currentMode,
          sessionTotalSeconds: currentTotalSeconds,
        };

        lastSyncRef.current = JSON.stringify({
          tasks: payload.tasks,
          sessionState: payload.sessionState,
          sessionStartMs: payload.sessionStartMs,
          pausedElapsed: payload.pausedElapsed,
          sessionMode: payload.sessionMode,
          sessionTotalSeconds: payload.sessionTotalSeconds,
        });

        const res = await fetch('/api/active-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) sessionSavedToDbRef.current = true;
      } catch (e: any) {
        console.error('Failed to save session:', e);
      } finally {
        isSavingRef.current = false;
      }
    }, SAVE_DEBOUNCE);
  }, [isLoggedIn, tasks, sessionState, sessionStartTime, pausedElapsed, sessionMode, sessionTotalSeconds]);

  // Immediate save for critical operations (bypasses debounce)
  const saveSessionToDbImmediate = useCallback(async (overrideTasks: Task[], overrideTotalSeconds: number) => {
    if (!isLoggedIn) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    isSavingRef.current = true;
    try {
      const payload = {
        tasks: overrideTasks,
        sessionState: sessionState,
        sessionStartMs: sessionStartTime ?? Date.now(),
        pausedElapsed: pausedElapsed,
        soundPlayed: Array.from(soundPlayedRef.current),
        sessionMode: sessionMode,
        sessionTotalSeconds: overrideTotalSeconds,
      };

      lastSyncRef.current = JSON.stringify({
        tasks: payload.tasks,
        sessionState: payload.sessionState,
        sessionStartMs: payload.sessionStartMs,
        pausedElapsed: payload.pausedElapsed,
        sessionMode: payload.sessionMode,
        sessionTotalSeconds: payload.sessionTotalSeconds,
      });

      const res = await fetch('/api/active-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) sessionSavedToDbRef.current = true;
    } catch (e: any) {
      console.error('Failed to save session immediately:', e);
    } finally {
      isSavingRef.current = false;
    }
  }, [isLoggedIn, sessionState, sessionStartTime, pausedElapsed, sessionMode]);

  const deleteSessionFromDb = async () => {
    if (!isLoggedIn) return;
    try {
      await fetch('/api/active-session', { method: 'DELETE' });
    } catch (e: any) {
      console.error('Failed to delete session:', e);
    }
  };

  // Timer tick
  useEffect(() => {
    if (sessionState === 'running') {
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const startT = sessionStartTime ?? now;
        const newElapsed = Math.floor((now - startT) / 1000) + (pausedElapsed ?? 0);
        setElapsedSeconds(newElapsed);
      }, 200);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionState, sessionStartTime, pausedElapsed]);

  // Check for timer sound triggers
  useEffect(() => {
    if (sessionState !== 'running') return;
    (tasks ?? []).forEach((task: Task) => {
      if (task?.isDone) return;
      const remaining = getRemainingTime(task);
      if (remaining <= 0 && !soundPlayedRef.current?.has(task?.id)) {
        soundPlayedRef.current?.add(task?.id);
        playTimerSound();
        saveSessionToDb();
      }
    });
  }, [elapsedSeconds, tasks, sessionState]);

  const getRemainingTime = useCallback((task: Task): number => {
    if (task?.isDone) return 0;
    const cumulative = task?.cumulativeSeconds ?? 0;
    return cumulative - (elapsedSeconds ?? 0);
  }, [elapsedSeconds]);

  const getProgress = useCallback((task: Task): number => {
    if (task?.isDone) return 0;
    const cumulative = task?.cumulativeSeconds ?? 0;
    const duration = task?.durationSeconds ?? 1;
    const taskStart = cumulative - duration;
    const taskElapsed = (elapsedSeconds ?? 0) - taskStart;
    const progress = Math.max(0, Math.min(1, 1 - taskElapsed / duration));
    return progress;
  }, [elapsedSeconds]);

  const handleStartSession = () => {
    if ((tasks?.length ?? 0) === 0) {
      toast.error('Add at least one task before starting');
      return;
    }
    soundPlayedRef.current = new Set();
    sessionSavedToDbRef.current = false;
    const startMs = Date.now();
    setSessionStartTime(startMs);
    setPausedElapsed(0);
    setElapsedSeconds(0);
    setSessionState('running');
    const resetTasks = recalculateCumulativeTimes(
      (tasks ?? []).map((t: Task) => ({ ...(t ?? {}), isDone: false, doneAt: null, bonusSeconds: 0 } as Task))
    );
    // Initialize sessionTotalSeconds with the sum of all task durations
    const totalSeconds = resetTasks.length > 0 ? resetTasks[resetTasks.length - 1].cumulativeSeconds : 0;
    setSessionTotalSeconds(totalSeconds);
    setTasks(resetTasks);
    saveSessionToDb(resetTasks, 'running', startMs, 0, sessionMode, totalSeconds);
  };

  const handlePause = () => {
    if (sessionState === 'running') {
      const newPausedElapsed = elapsedSeconds;
      setPausedElapsed(newPausedElapsed);
      setSessionStartTime(null);
      setSessionState('paused');
      saveSessionToDb(tasks, 'paused', null, newPausedElapsed);
    } else if (sessionState === 'paused') {
      const startMs = Date.now();
      setSessionStartTime(startMs);
      setSessionState('running');
      saveSessionToDb(tasks, 'running', startMs, pausedElapsed);
    }
  };

  const logCompletedTasks = useCallback(async (completedTasks: Task[]) => {
    if (completedTasks.length === 0) return;

    const payload = completedTasks.map(t => ({
      name: t.name,
      durationSeconds: t.durationSeconds,
      color: t.color ?? 'orange',
      completedAt: t.doneAt ? new Date(t.doneAt).toISOString() : new Date().toISOString(),
    }));

    if (isLoggedIn) {
      try {
        await fetch('/api/completion-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: payload }),
        });
      } catch (e) {
        console.error('Failed to log completions:', e);
      }
    } else {
      // Guest: save to localStorage
      try {
        const key = 'countdowndo-completion-history';
        const existing: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        const newEntries = payload.map((t, i) => ({
          id: `local-${Date.now()}-${i}`,
          taskName: t.name,
          durationSeconds: t.durationSeconds,
          color: t.color ?? 'orange',
          completedAt: t.completedAt,
        }));
        const all = [...newEntries, ...existing];
        // Keep only last 60 days
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 60);
        cutoff.setHours(0, 0, 0, 0);
        const filtered = all.filter(e => new Date(e.completedAt) >= cutoff);
        localStorage.setItem(key, JSON.stringify(filtered));
      } catch {}
    }
    // Notify the history component to refresh
    window.dispatchEvent(new Event('completion-log-updated'));
  }, [isLoggedIn]);

  const handleStop = () => {
    // Trigger celebration animation and sound
    celebrate();
    
    setSessionState('idle');
    setSessionStartTime(null);
    setPausedElapsed(0);
    setElapsedSeconds(0);
    setSessionTotalSeconds(0);
    soundPlayedRef.current = new Set();
    // In continuous mode, filter out done tasks when stopping so only unfinished ones remain
    setTasks((prev: Task[]) => {
      const remaining = sessionMode === 'continuous'
        ? (prev ?? []).filter((t: Task) => !t?.isDone)
        : (prev ?? []);
      return recalculateCumulativeTimes(
        remaining.map((t: Task) => ({ ...(t ?? {}), isDone: false, doneAt: null, bonusSeconds: 0 } as Task))
      );
    });
    deleteSessionFromDb();
  };

  const handleMarkDone = (taskId: string) => {
    setTasks((prev: Task[]) => {
      const idx = (prev ?? []).findIndex((t: Task) => t?.id === taskId);
      if (idx < 0) return prev ?? [];
      const task = prev[idx];

      const updated = (prev ?? []).map((t: Task, i: number) => {
        if (i === idx) {
          // Toggle: if already done, uncheck it; otherwise mark done
          return task?.isDone
            ? { ...(t ?? {}), isDone: false, doneAt: null } as Task
            : { ...(t ?? {}), isDone: true, doneAt: Date.now() } as Task;
        }
        return t;
      });

      // Log immediately when marking done (not when unchecking)
      if (!task?.isDone) {
        logCompletedTasks([{ ...task, isDone: true, doneAt: Date.now() }]);
      }

      saveSessionToDb(updated);
      return updated;
    });
  };

  const handleAddTask = (name: string, durationSeconds: number, position: 'top' | 'bottom' = 'bottom', color: TaskColorId = 'orange') => {
    const isActiveContinuous = sessionState !== 'idle' && sessionMode === 'continuous';

    setTasks((prev: Task[]) => {
      const list = prev ?? [];

      if (isActiveContinuous) {
        // In continuous mode: insert without recalculating existing tasks.
        // Guard: derive effectiveTotal if sessionTotalSeconds is 0
        let effectiveTotal = sessionTotalSeconds;
        if (effectiveTotal <= 0 && list.length > 0) {
          effectiveTotal = list[list.length - 1]?.cumulativeSeconds ?? 0;
        }

        if (position === 'top') {
          // Prepend and recalculate all cumulative times
          const newTask: Task = {
            id: generateId(),
            name,
            durationSeconds,
            cumulativeSeconds: 0,
            isDone: false,
            doneAt: null,
            bonusSeconds: 0,
            color,
          };
          const updated = recalculateCumulativeTimes([newTask, ...list]);
          const newTotalSeconds = effectiveTotal + durationSeconds;
          setSessionTotalSeconds(newTotalSeconds);
          saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotalSeconds);
          return updated;
        } else {
          const newTask: Task = {
            id: generateId(),
            name,
            durationSeconds,
            cumulativeSeconds: effectiveTotal + durationSeconds,
            isDone: false,
            doneAt: null,
            bonusSeconds: 0,
            color,
          };
          const updated = [...list, newTask];
          const newTotalSeconds = effectiveTotal + durationSeconds;
          setSessionTotalSeconds(newTotalSeconds);
          saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotalSeconds);
          return updated;
        }
      } else {
        // Idle or sprint: full recalculation
        const newTask: Task = {
          id: generateId(),
          name,
          durationSeconds,
          cumulativeSeconds: 0,
          isDone: false,
          doneAt: null,
          bonusSeconds: 0,
          color,
        };
        const withNew = position === 'top' ? [newTask, ...list] : [...list, newTask];
        const updated = recalculateCumulativeTimes(withNew);
        return updated;
      }
    });
  };

  const handleDeleteTask = (taskId: string) => {
    const isActive = sessionState !== 'idle';

    // In continuous mode during an active session, treat delete as "mark done" and remove from list
    if (isActive && sessionMode === 'continuous') {
      setTasks((prev: Task[]) => {
        const deletedTask = (prev ?? []).find((t: Task) => t?.id === taskId);
        // Log the deleted task as completed
        if (deletedTask && !deletedTask.isDone) {
          logCompletedTasks([{ ...deletedTask, isDone: true, doneAt: Date.now() }]);
        }
        // Filter out the task (remove from display)
        const filtered = (prev ?? []).filter((t: Task) => t?.id !== taskId);
        saveSessionToDb(filtered);
        return filtered;
      });
      return;
    }

    // Sprint mode or idle: actually remove the task and recalculate
    setTasks((prev: Task[]) => {
      const filtered = (prev ?? []).filter((t: Task) => t?.id !== taskId);
      const updated = recalculateCumulativeTimes(filtered);
      if (isActive) saveSessionToDb(updated);
      return updated;
    });
  };

  const handleEditTask = (taskId: string, name: string, durationSeconds: number, color?: TaskColorId) => {
    const isActiveContinuous = sessionState !== 'idle' && sessionMode === 'continuous';

    setTasks((prev: Task[]) => {
      const list = prev ?? [];

      if (isActiveContinuous) {
        // In continuous mode: shift the edited task and all subsequent tasks by the delta,
        // and adjust sessionTotalSeconds by the same delta.
        const idx = list.findIndex((t: Task) => t?.id === taskId);
        if (idx < 0) return list;
        const oldDuration = list[idx]?.durationSeconds ?? 0;
        const delta = durationSeconds - oldDuration;

        const updated = list.map((t: Task, i: number) => {
          if (i === idx) {
            return { ...(t ?? {}), name, durationSeconds, cumulativeSeconds: (t?.cumulativeSeconds ?? 0) + delta, ...(color ? { color } : {}) } as Task;
          }
          if (i > idx) {
            return { ...(t ?? {}), cumulativeSeconds: (t?.cumulativeSeconds ?? 0) + delta } as Task;
          }
          return t;
        });

        // Guard: derive effectiveTotal if sessionTotalSeconds is 0
        let effectiveTotal = sessionTotalSeconds;
        if (effectiveTotal <= 0 && list.length > 0) {
          effectiveTotal = list[list.length - 1]?.cumulativeSeconds ?? 0;
        }
        // Adjust sessionTotalSeconds by the delta
        const newTotalSeconds = effectiveTotal + delta;
        setSessionTotalSeconds(newTotalSeconds);
        saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotalSeconds);
        return updated;
      }

      // Sprint mode or idle: full recalculation
      const updated = recalculateCumulativeTimes(
        list.map((t: Task) =>
          t?.id === taskId ? { ...(t ?? {}), name, durationSeconds, ...(color ? { color } : {}) } as Task : t
        )
      );
      if (sessionState !== 'idle') {
        const newTotalSeconds = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
        setSessionTotalSeconds(newTotalSeconds);
        saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotalSeconds);
      }
      return updated;
    });
  };

  const handleReorder = (newTasks: Task[]) => {
    const isActiveContinuous = sessionState !== 'idle' && sessionMode === 'continuous';

    if (isActiveContinuous) {
      // CONTINUOUS MODE: Preserve sessionTotalSeconds envelope
      // Use setTasks callback to avoid stale closure, and save immediately
      setTasks((prevTasks: Task[]) => {
        const sumOfDurations = (newTasks ?? []).reduce((sum: number, t: Task) => sum + (t?.durationSeconds ?? 0), 0);

        // Guard: if sessionTotalSeconds is 0/unset (legacy session or migration),
        // derive it from the last task's cumulative time in prevTasks
        let effectiveTotal = sessionTotalSeconds;
        if (effectiveTotal <= 0 && prevTasks.length > 0) {
          effectiveTotal = prevTasks[prevTasks.length - 1]?.cumulativeSeconds ?? 0;
          console.warn('[handleReorder] sessionTotalSeconds was 0, derived from prevTasks:', effectiveTotal);
        }
        // Additional guard: effectiveTotal must be at least sumOfDurations
        if (effectiveTotal < sumOfDurations) {
          effectiveTotal = sumOfDurations;
          console.warn('[handleReorder] effectiveTotal < sumOfDurations, clamped to:', effectiveTotal);
        }

        const baseOffset = effectiveTotal - sumOfDurations;

        let cumulative = baseOffset;
        const updated = (newTasks ?? []).map((task: Task) => {
          cumulative += task?.durationSeconds ?? 0;
          return { ...(task ?? {}), cumulativeSeconds: cumulative } as Task;
        });

        // Diagnostic logging
        const prevTotal = prevTasks.length > 0 ? prevTasks[prevTasks.length - 1]?.cumulativeSeconds ?? 0 : 0;
        const newTotal = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
        console.log('[handleReorder] CONTINUOUS', {
          sessionTotalSeconds,
          effectiveTotal,
          prevTotal,
          newTotal,
          baseOffset,
          sumOfDurations,
          prevTaskCount: prevTasks.length,
          newTaskCount: updated.length,
        });

        if (newTotal !== effectiveTotal) {
          console.warn('[handleReorder] ⚠ MISMATCH: newTotal !== effectiveTotal!', { newTotal, effectiveTotal });
        }

        // If sessionTotalSeconds was wrong, fix it in state too
        if (sessionTotalSeconds !== effectiveTotal) {
          setSessionTotalSeconds(effectiveTotal);
        }

        // Save immediately (bypass debounce to prevent race)
        saveSessionToDbImmediate(updated, effectiveTotal);
        return updated;
      });
      return;
    }

    // SPRINT MODE or IDLE: Full recalculation
    const updated = recalculateCumulativeTimes(newTasks ?? []);
    const newTotal = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
    console.log('[handleReorder] SPRINT/IDLE', { newTotal, sessionState, sessionMode });
    setTasks(updated);
    if (sessionState !== 'idle') {
      // Sprint mode: sessionTotalSeconds = sum of task durations (no gaps)
      setSessionTotalSeconds(newTotal);
      saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotal);
    }
  };

  const handleSaveList = async (name: string) => {
    if (!isLoggedIn) {
      toast.error('Please log in to save task lists');
      return;
    }
    try {
      const tasksData = (tasks ?? []).map((t: Task) => ({
        name: t?.name ?? '',
        durationSeconds: t?.durationSeconds ?? 300,
        color: t?.color ?? 'orange',
      }));
      const res = await fetch('/api/saved-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tasks: tasksData }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err?.error ?? 'Failed to save');
        return;
      }
      toast.success('List saved!');
      fetchSavedLists();
    } catch (e: any) {
      console.error('Save list error:', e);
      toast.error('Failed to save list');
    }
  };

  const handleLoadList = (list: SavedListData) => {
    const loadedTasks: Task[] = ((list?.tasks as any[]) ?? []).map((t: any) => ({
      id: generateId(),
      name: t?.name ?? 'Task',
      durationSeconds: t?.durationSeconds ?? 300,
      cumulativeSeconds: 0,
      isDone: false,
      doneAt: null,
      bonusSeconds: 0,
      color: (t?.color as TaskColorId) ?? 'orange',
    }));
    setTasks(recalculateCumulativeTimes(loadedTasks));
    if (sessionState !== 'idle') {
      handleStop();
    }
    toast.success(`Loaded "${list?.name ?? 'list'}"`);
  };

  const handleDeleteSavedList = async (id: string) => {
    try {
      await fetch(`/api/saved-lists/${id}`, { method: 'DELETE' });
      toast.success('List deleted');
      fetchSavedLists();
    } catch (e: any) {
      console.error('Delete list error:', e);
    }
  };

  const handleRenameSavedList = async (id: string, newName: string) => {
    try {
      await fetch(`/api/saved-lists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      toast.success('List renamed');
      fetchSavedLists();
    } catch (e: any) {
      console.error('Rename list error:', e);
    }
  };

  const isSession = sessionState === 'running' || sessionState === 'paused';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1200px] mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center glow-primary">
              <Timer className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
              CountdownDo
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/40 px-3 py-1.5 rounded-full">
              <ListChecks className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{tasks?.length ?? 0} task{(tasks?.length ?? 0) !== 1 ? 's' : ''}</span>
            </div>
            {isLoggedIn ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {authSession?.user?.email}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="p-2 rounded-xl hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-all"
                  title="Log out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 px-4 py-2 rounded-xl gradient-primary text-primary-foreground hover:opacity-90 transition-all text-sm font-semibold shadow-md"
              >
                <LogIn className="w-4 h-4" />
                <span>Log in</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Guest warning banner */}
      {!isLoggedIn && authStatus !== 'loading' && !warningDismissed && (
        <div className="bg-amber-500/[0.06] border-b border-amber-500/15">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              </div>
              <p className="text-amber-200/80 text-xs">
                You are not logged in. Your tasks and lists <strong className="text-amber-200">will not be saved</strong> — a page refresh will reset everything.{' '}
                <Link href="/login" className="text-primary hover:underline font-medium">Create an account</Link>{' '}
                to save your data and sync across devices.
              </p>
            </div>
            <button
              onClick={() => setWarningDismissed(true)}
              className="p-1.5 rounded-lg hover:bg-amber-500/15 text-amber-400/50 hover:text-amber-400 transition-colors flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="mb-8 text-center">
          <p className="text-muted-foreground text-sm">
            Plan your tasks with cumulative time-blocking, then start the session to track everything at once.
          </p>
        </div>

        <div className={`grid grid-cols-1 ${isLoggedIn ? 'lg:grid-cols-[1fr_340px]' : ''} gap-8`}>
          <div>
            {!isSession ? (
              <TaskInputPanel
                tasks={tasks}
                sessionMode={sessionMode}
                taskOrder={taskOrder}
                planningStartTime={planningStartTime}
                onToggleOrder={toggleTaskOrder}
                onPlanningStartTimeChange={setPlanningStartTime}
                onSessionModeChange={setSessionMode}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onEditTask={handleEditTask}
                onReorder={handleReorder}
                onStartSession={handleStartSession}
              />
            ) : (
              <ActiveSession
                tasks={tasks}
                sessionState={sessionState}
                sessionMode={sessionMode}
                sessionTotalSeconds={sessionTotalSeconds}
                elapsedSeconds={elapsedSeconds}
                sessionStartTimestamp={sessionStartTime ?? 0}
                pausedElapsed={pausedElapsed}
                taskOrder={taskOrder}
                onToggleOrder={toggleTaskOrder}
                getRemainingTime={getRemainingTime}
                getProgress={getProgress}
                onMarkDone={handleMarkDone}
                onPause={handlePause}
                onStop={handleStop}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onEditTask={handleEditTask}
                onReorder={handleReorder}
              />
            )}
          </div>

          {/* Sidebar - saved lists & history */}
          {isLoggedIn && (
            <div className="space-y-4">
              {/* Tab switcher */}
              <div className="flex rounded-xl bg-secondary/30 p-1 border border-border/40 glass-card">
                <button
                  onClick={() => setSidebarTab('lists')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    sidebarTab === 'lists'
                      ? 'bg-primary/15 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  Lists
                </button>
                <button
                  onClick={() => setSidebarTab('history')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    sidebarTab === 'history'
                      ? 'bg-primary/15 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  History
                </button>
                <button
                  onClick={() => setSidebarTab('dashboard')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    sidebarTab === 'dashboard'
                      ? 'bg-primary/15 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Stats
                </button>
              </div>

              {sidebarTab === 'lists' ? (
                <SavedLists
                  savedLists={savedLists}
                  currentTasks={tasks}
                  onSaveList={handleSaveList}
                  onLoadList={handleLoadList}
                  onDeleteList={handleDeleteSavedList}
                  onRenameList={handleRenameSavedList}
                />
              ) : sidebarTab === 'history' ? (
                <CompletionHistory isLoggedIn={isLoggedIn} />
              ) : (
                <Dashboard isLoggedIn={isLoggedIn} />
              )}
            </div>
          )}
        </div>

        {/* Guest history & dashboard section - shown below main content */}
        {!isLoggedIn && authStatus !== 'loading' && (
          <div className="mt-8 space-y-8">
            <Dashboard isLoggedIn={false} />
            <CompletionHistory isLoggedIn={false} />
          </div>
        )}
      </div>
    </div>
  );
}
