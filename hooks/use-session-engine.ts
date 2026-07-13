import { useState, useEffect, useCallback, useRef } from 'react';
import { Task, BankTask, SessionState, SessionMode, TaskOrder, TaskColorId } from '@/lib/types';
import { generateId, recalculateCumulativeTimes } from '@/lib/timer-utils';
import { playTimerSound } from '@/lib/use-timer-sound';
import { celebrate } from '@/lib/celebrate';
import { toast } from 'sonner';

const SYNC_INTERVAL = 3000;
const SAVE_DEBOUNCE = 1000;

// Owns the timer engine (tick/remaining/progress), cross-device sync
// (load/poll/save/conflict-resolution), and task-list mutations for the
// active session. Extracted out of SequenceApp so that component can stay
// focused on rendering the three views (planning, active session, sidebar).
export function useSessionEngine(isLoggedIn: boolean) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [pausedElapsed, setPausedElapsed] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [sessionMode, setSessionMode] = useState<SessionMode>('continuous');
  const [sessionTotalSeconds, setSessionTotalSeconds] = useState<number>(0);
  const [taskOrder, setTaskOrder] = useState<TaskOrder>('desc');
  const [planningStartTime, setPlanningStartTime] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const soundPlayedRef = useRef<Set<string>>(new Set());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncRef = useRef<string>('');
  const isSavingRef = useRef(false);
  const sessionSavedToDbRef = useRef(false);
  // The updatedAt of the ActiveSession row this client last saw. Sent on every
  // save so the server can detect a write from another device/tab that
  // happened in between — see the 409 handling in saveSessionToDb.
  const lastKnownUpdatedAtRef = useRef<string | null>(null);
  const initialLoadDone = useRef(false);

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

  // Fetch active session on mount (only if logged in)
  useEffect(() => {
    if (isLoggedIn) {
      loadActiveSession();
    } else {
      initialLoadDone.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, sessionState]);

  // Applies a full ActiveSession row from the server to local state — shared by
  // the initial load, the cross-device poll, and 409-conflict reconciliation
  // (all three need to do exactly the same "adopt the server's version" thing).
  const applyRemoteSessionData = useCallback((data: any) => {
    const loadedTasks = (data.tasks as Task[]) ?? [];
    setTasks(loadedTasks);
    setSessionMode((data.sessionMode as SessionMode) ?? 'continuous');

    // Auto-heal: if sessionTotalSeconds is 0 but session is active with tasks,
    // derive it from the last task's cumulative (legacy/migration safety)
    let total = data.sessionTotalSeconds ?? 0;
    if (total <= 0 && loadedTasks.length > 0 && data.sessionState !== 'idle') {
      total = loadedTasks[loadedTasks.length - 1]?.cumulativeSeconds ?? 0;
    }
    setSessionTotalSeconds(total);
    soundPlayedRef.current = new Set((data.soundPlayed as string[]) ?? []);

    if (data.sessionState === 'running') {
      setSessionState('running');
      setSessionStartTime(data.sessionStartMs);
      setPausedElapsed(data.pausedElapsed ?? 0);
    } else if (data.sessionState === 'paused') {
      setSessionState('paused');
      setSessionStartTime(null);
      setPausedElapsed(data.pausedElapsed ?? 0);
    } else {
      setSessionState('idle');
      setSessionStartTime(null);
      setPausedElapsed(0);
    }

    lastKnownUpdatedAtRef.current = data.updatedAt ?? null;
    lastSyncRef.current = JSON.stringify({
      tasks: data.tasks,
      sessionState: data.sessionState,
      sessionStartMs: data.sessionStartMs,
      pausedElapsed: data.pausedElapsed,
      sessionMode: data.sessionMode,
      sessionTotalSeconds: data.sessionTotalSeconds ?? 0,
    });
    sessionSavedToDbRef.current = data.sessionState === 'running' || data.sessionState === 'paused';
  }, []);

  const loadActiveSession = async () => {
    try {
      const res = await fetch('/api/active-session');
      if (!res.ok) return;
      const data = await res.json();
      if (!data) {
        initialLoadDone.current = true;
        return;
      }
      applyRemoteSessionData(data);
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
          lastKnownUpdatedAtRef.current = null;
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
        applyRemoteSessionData(data);
      } else {
        // Data is unchanged, but still track the latest updatedAt/timing fields
        // in case this poll is racing a save that's about to conflict-check.
        lastKnownUpdatedAtRef.current = data.updatedAt ?? lastKnownUpdatedAtRef.current;
        if (data.sessionState === 'running') {
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
          lastKnownUpdatedAt: lastKnownUpdatedAtRef.current,
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
        if (res.status === 409) {
          // Another device/tab saved since we last synced — adopt its state
          // instead of retrying this (now-stale) write over it.
          const conflictBody = await res.json().catch(() => null);
          if (conflictBody?.latest) {
            applyRemoteSessionData(conflictBody.latest);
            toast.info('Synced with a more recent change from another device');
          }
        } else if (res.ok) {
          const saved = await res.json().catch(() => null);
          if (saved?.updatedAt) lastKnownUpdatedAtRef.current = saved.updatedAt;
          sessionSavedToDbRef.current = true;
        }
      } catch (e: any) {
        console.error('Failed to save session:', e);
      } finally {
        isSavingRef.current = false;
      }
    }, SAVE_DEBOUNCE);
  }, [isLoggedIn, tasks, sessionState, sessionStartTime, pausedElapsed, sessionMode, sessionTotalSeconds, applyRemoteSessionData]);

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
        lastKnownUpdatedAt: lastKnownUpdatedAtRef.current,
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
      if (res.status === 409) {
        const conflictBody = await res.json().catch(() => null);
        if (conflictBody?.latest) {
          applyRemoteSessionData(conflictBody.latest);
          toast.info('Synced with a more recent change from another device');
        }
      } else if (res.ok) {
        const saved = await res.json().catch(() => null);
        if (saved?.updatedAt) lastKnownUpdatedAtRef.current = saved.updatedAt;
        sessionSavedToDbRef.current = true;
      }
    } catch (e: any) {
      console.error('Failed to save session immediately:', e);
    } finally {
      isSavingRef.current = false;
    }
  }, [isLoggedIn, sessionState, sessionStartTime, pausedElapsed, sessionMode, applyRemoteSessionData]);

  const deleteSessionFromDb = async () => {
    if (!isLoggedIn) return;
    try {
      await fetch('/api/active-session', { method: 'DELETE' });
      lastKnownUpdatedAtRef.current = null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSeconds, tasks, sessionState]);

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
      (tasks ?? []).map((t: Task) => ({ ...(t ?? {}), isDone: false, doneAt: null, bonusSeconds: 0, completionLogId: null } as Task))
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

  // Logs completed tasks and returns a map of task.id -> completion-log entry id,
  // so the caller can remember it on the task (enables retraction if un-marked later).
  const logCompletedTasks = useCallback(async (completedTasks: Task[]): Promise<Record<string, string>> => {
    if (completedTasks.length === 0) return {};

    const payload = completedTasks.map(t => ({
      name: t.name,
      durationSeconds: t.durationSeconds,
      color: t.color ?? 'orange',
      completedAt: t.doneAt ? new Date(t.doneAt).toISOString() : new Date().toISOString(),
    }));

    const idMap: Record<string, string> = {};

    if (isLoggedIn) {
      try {
        const res = await fetch('/api/completion-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: payload }),
        });
        if (res.ok) {
          const data = await res.json();
          (data.logs ?? []).forEach((log: any, i: number) => {
            const taskId = completedTasks[i]?.id;
            if (taskId && log?.id) idMap[taskId] = log.id;
          });
        }
      } catch (e) {
        console.error('Failed to log completions:', e);
      }
    } else {
      // Guest: save to localStorage
      try {
        const key = 'countdowndo-completion-history';
        const existing: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        const newEntries = payload.map((t, i) => {
          const id = `local-${Date.now()}-${i}`;
          const taskId = completedTasks[i]?.id;
          if (taskId) idMap[taskId] = id;
          return {
            id,
            taskName: t.name,
            durationSeconds: t.durationSeconds,
            color: t.color ?? 'orange',
            completedAt: t.completedAt,
          };
        });
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
    return idMap;
  }, [isLoggedIn]);

  // Deletes a one-off bank task when it's completed or removed from session
  const deleteOneOffBankTask = useCallback(async (bankTaskId: string) => {
    if (!isLoggedIn || !bankTaskId) return;
    try {
      await fetch(`/api/task-bank/${bankTaskId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete one-off bank task:', e);
    }
  }, [isLoggedIn]);

  // Retracts a completion-log entry — used when a task is un-marked as done,
  // so toggling done -> undone -> done doesn't leave a duplicate stats entry behind.
  const retractCompletionLog = useCallback(async (completionLogId: string) => {
    if (isLoggedIn) {
      try {
        await fetch('/api/completion-log', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: completionLogId }),
        });
      } catch (e) {
        console.error('Failed to retract completion log:', e);
      }
    } else {
      try {
        const key = 'countdowndo-completion-history';
        const existing: any[] = JSON.parse(localStorage.getItem(key) || '[]');
        const filtered = existing.filter((e) => e.id !== completionLogId);
        localStorage.setItem(key, JSON.stringify(filtered));
      } catch {}
    }
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
        remaining.map((t: Task) => ({ ...(t ?? {}), isDone: false, doneAt: null, bonusSeconds: 0, completionLogId: null } as Task))
      );
    });
    deleteSessionFromDb();
  };

  // Marking done and un-marking are handled outside the setTasks updater (rather than
  // inside it, as this used to be written) because logCompletedTasks/retractCompletionLog
  // create/delete a database row — a non-idempotent side effect that must fire exactly
  // once per call, not something safe to leave where React could invoke it twice.
  const handleMarkDone = (taskId: string) => {
    const idx = (tasks ?? []).findIndex((t: Task) => t?.id === taskId);
    if (idx < 0) return;
    const task = tasks[idx];

    if (task?.isDone) {
      // Un-marking: retract the log entry we created (if any), so a later
      // done -> undone -> done cycle doesn't leave two entries behind.
      const updated = tasks.map((t: Task, i: number) =>
        i === idx ? { ...t, isDone: false, doneAt: null, completionLogId: null } as Task : t
      );
      setTasks(updated);
      saveSessionToDb(updated);
      if (task.completionLogId) {
        retractCompletionLog(task.completionLogId);
      }
      return;
    }

    // Marking done: update immediately, then attach the log entry's id once it comes back.
    const doneAt = Date.now();
    const provisional = tasks.map((t: Task, i: number) =>
      i === idx ? { ...t, isDone: true, doneAt } as Task : t
    );
    setTasks(provisional);
    saveSessionToDb(provisional);

    // If this is a one-off bank task, delete it from the bank
    if (task.isOneOffBankTask && task.bankTaskId) {
      deleteOneOffBankTask(task.bankTaskId);
    }

    logCompletedTasks([{ ...task, isDone: true, doneAt }]).then((idMap) => {
      const logId = idMap[taskId];
      if (!logId) return;
      // Use the functional form here: this resolves after an await, so the
      // task list may have changed since `provisional` was captured (e.g. the
      // user added/reordered tasks). Patching against the live `prev` avoids
      // clobbering that. saveSessionToDb is an idempotent upsert, so it's
      // safe inside the updater even if React ever invoked it twice.
      setTasks((prev: Task[]) => {
        const withLogId = prev.map((t: Task) =>
          t.id === taskId ? { ...t, completionLogId: logId } : t
        );
        saveSessionToDb(withLogId);
        return withLogId;
      });
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
        // Persist regardless of session state (including idle) so a staged
        // pre-session task list survives a refresh, same as an active one
        // already does. No-ops internally for guests.
        const newTotal = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
        setSessionTotalSeconds(newTotal);
        saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotal);
        return updated;
      }
    });
  };

  // Adds a whole batch of Task Bank tasks in one setTasks call rather than
  // looping handleAddTask per item. Looping would have each call read the same
  // pre-batch `sessionTotalSeconds` closure (state updates aren't visible again
  // until the next render), so every task after the first got the wrong
  // cumulative time. Computing the batch in one pass sidesteps that entirely.
  const handleAddFromBank = (bankTasks: BankTask[]) => {
    if (bankTasks.length === 0) return;
    const isActiveContinuous = sessionState !== 'idle' && sessionMode === 'continuous';

    setTasks((prev: Task[]) => {
      const list = prev ?? [];

      if (isActiveContinuous) {
        let effectiveTotal = sessionTotalSeconds;
        if (effectiveTotal <= 0 && list.length > 0) {
          effectiveTotal = list[list.length - 1]?.cumulativeSeconds ?? 0;
        }
        let running = effectiveTotal;
        const newTasks: Task[] = bankTasks.map((bt) => {
          running += bt.durationSeconds;
          return {
            id: generateId(),
            name: bt.name,
            durationSeconds: bt.durationSeconds,
            cumulativeSeconds: running,
            isDone: false,
            doneAt: null,
            bonusSeconds: 0,
            color: bt.color,
            bankTaskId: bt.id,
            isOneOffBankTask: bt.isOneOff,
          };
        });
        const updated = [...list, ...newTasks];
        setSessionTotalSeconds(running);
        saveSessionToDb(updated, undefined, undefined, undefined, undefined, running);
        return updated;
      }

      // Idle or sprint: full recalculation
      const newTasks: Task[] = bankTasks.map((bt) => ({
        id: generateId(),
        name: bt.name,
        durationSeconds: bt.durationSeconds,
        cumulativeSeconds: 0,
        isDone: false,
        doneAt: null,
        bonusSeconds: 0,
        color: bt.color,
        bankTaskId: bt.id,
        isOneOffBankTask: bt.isOneOff,
      }));
      const updated = recalculateCumulativeTimes([...list, ...newTasks]);
      // Persist regardless of session state — see the comment in handleAddTask.
      const newTotal = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
      setSessionTotalSeconds(newTotal);
      saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotal);
      return updated;
    });

    toast.success(`Added ${bankTasks.length} task${bankTasks.length !== 1 ? 's' : ''} from bank`);
  };

  const handleDeleteTask = (taskId: string) => {
    const isActive = sessionState !== 'idle';
    const deletedTask = (tasks ?? []).find((t: Task) => t?.id === taskId);

    // In continuous mode during an active session, treat delete as "mark done" and remove from list
    if (isActive && sessionMode === 'continuous') {
      const filtered = (tasks ?? []).filter((t: Task) => t?.id !== taskId);
      setTasks(filtered);
      saveSessionToDb(filtered);
      // Log outside the updater — this creates a DB row, so it must fire exactly once.
      if (deletedTask && !deletedTask.isDone) {
        logCompletedTasks([{ ...deletedTask, isDone: true, doneAt: Date.now() }]);
      }
      // If this is a one-off bank task, delete it from the bank
      if (deletedTask?.isOneOffBankTask && deletedTask?.bankTaskId) {
        deleteOneOffBankTask(deletedTask.bankTaskId);
      }
      return;
    }

    // Sprint mode or idle: actually remove the task and recalculate.
    // Persisted regardless of isActive so a staged pre-session list survives a refresh.
    const filtered = (tasks ?? []).filter((t: Task) => t?.id !== taskId);
    const updated = recalculateCumulativeTimes(filtered);
    setTasks(updated);
    saveSessionToDb(updated);
    // If this is a one-off bank task, delete it from the bank
    if (deletedTask?.isOneOffBankTask && deletedTask?.bankTaskId) {
      deleteOneOffBankTask(deletedTask.bankTaskId);
    }
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

      // Sprint mode or idle: full recalculation. Persisted regardless of
      // session state — see the comment in handleAddTask.
      const updated = recalculateCumulativeTimes(
        list.map((t: Task) =>
          t?.id === taskId ? { ...(t ?? {}), name, durationSeconds, ...(color ? { color } : {}) } as Task : t
        )
      );
      const newTotalSeconds = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
      setSessionTotalSeconds(newTotalSeconds);
      saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotalSeconds);
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

    // SPRINT MODE or IDLE: full recalculation, sessionTotalSeconds = sum of
    // task durations (no gaps). Persisted regardless of session state — see
    // the comment in handleAddTask.
    const updated = recalculateCumulativeTimes(newTasks ?? []);
    const newTotal = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
    setTasks(updated);
    setSessionTotalSeconds(newTotal);
    saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotal);
  };

  const isSession = sessionState === 'running' || sessionState === 'paused';

  return {
    tasks,
    sessionState,
    sessionStartTime,
    pausedElapsed,
    elapsedSeconds,
    sessionMode,
    setSessionMode,
    sessionTotalSeconds,
    taskOrder,
    toggleTaskOrder,
    planningStartTime,
    setPlanningStartTime,
    isSession,
    getRemainingTime,
    getProgress,
    handleStartSession,
    handlePause,
    handleStop,
    handleMarkDone,
    handleAddTask,
    handleAddFromBank,
    handleDeleteTask,
    handleEditTask,
    handleReorder,
  };
}
