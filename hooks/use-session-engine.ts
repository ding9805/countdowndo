import { useState, useEffect, useCallback, useRef } from 'react';
import { Task, SessionState, SessionMode, TaskOrder, TaskColorId, PickedBankTask } from '@/lib/types';
import { generateId, recalculateCumulativeTimes, recalculateCumulativeTimesWithEnvelope } from '@/lib/timer-utils';
import { playTimerSound, TimerChime } from '@/lib/use-timer-sound';
import { celebrate } from '@/lib/celebrate';
import { shouldApplyPolledSession } from '@/lib/session-sync';
import { toast } from 'sonner';

const SYNC_INTERVAL = 3000;
const SAVE_DEBOUNCE = 1000;
// How long to wait before re-sending a save that failed (network error or a
// non-409 error status). Matches the poll interval so a retry always lands
// before the next poll could otherwise revert the unsaved change.
const SAVE_RETRY_DELAY = 3000;

interface SessionPayload {
  tasks: Task[];
  sessionState: SessionState;
  sessionStartMs: number;
  pausedElapsed: number;
  soundPlayed: string[];
  sessionMode: SessionMode;
  sessionTotalSeconds: number;
}

function syncKey(p: {
  tasks: unknown;
  sessionState: unknown;
  sessionStartMs: unknown;
  pausedElapsed: unknown;
  sessionMode: unknown;
  sessionTotalSeconds?: unknown;
}): string {
  return JSON.stringify({
    tasks: p.tasks,
    sessionState: p.sessionState,
    sessionStartMs: p.sessionStartMs,
    pausedElapsed: p.pausedElapsed,
    sessionMode: p.sessionMode,
    sessionTotalSeconds: p.sessionTotalSeconds ?? 0,
  });
}

// Owns the timer engine (tick/remaining/progress), cross-device sync
// (load/poll/save/conflict-resolution), and task-list mutations for the
// active session. Extracted out of SequenceApp so that component can stay
// focused on rendering the three views (planning, active session, sidebar).
export function useSessionEngine(isLoggedIn: boolean, alarmEnabled: boolean, chime: TimerChime, sessionVolume: number) {
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
  // Saves are full-state snapshots, so only the newest one queued matters.
  // Sends are serialized through saveChainRef so a second save never leaves
  // while the first is in flight: it would carry the first save's (now stale)
  // lastKnownUpdatedAt, get a 409 from our own write, and roll local state
  // back to the first payload. A failed send stays queued and is retried.
  const queuedPayloadRef = useRef<SessionPayload | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Bumped by handleStop (and a cross-device stop seen by the poll) so async
  // callbacks captured during a session — the completion-log id attach, a
  // queued save — can tell the session they belong to has already ended.
  const sessionEpochRef = useRef(0);
  // Completion-log requests still in flight, keyed by task id. Un-marking a
  // task before its log id has come back can't retract anything yet, so it
  // flags the entry as cancelled and the retraction runs when the id lands.
  const pendingLogRef = useRef<Map<string, { promise: Promise<Record<string, string>>; cancelled: boolean }>>(new Map());
  // Bumped synchronously by every local write, before its debounce. A poll
  // response is only trustworthy if this is unchanged across the poll's fetch:
  // a poll issued just before a local change (e.g. Clear all) comes back
  // carrying the pre-change task list and would resurrect the cleared tasks.
  const writeSeqRef = useRef(0);
  const sessionSavedToDbRef = useRef(false);
  // The updatedAt of the ActiveSession row this client last saw. Sent on every
  // save so the server can detect a write from another device/tab that
  // happened in between — see the 409 handling in saveSessionToDb.
  const lastKnownUpdatedAtRef = useRef<string | null>(null);
  const initialLoadDone = useRef(false);
  // Bank task ids that should be swept at session end. In continuous mode a
  // task can be removed mid-session (logged as done but filtered out of the
  // list), so it wouldn't be caught by a simple "isDone" scan at stop time.
  const pendingOneOffBankTaskIdsRef = useRef<Set<string>>(new Set());

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
    // Coerce any legacy/non-continuous value (e.g. old 'sprint' rows) to 'continuous'.
    setSessionMode('continuous');

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
      // The tick effect only runs while running, so a paused session has to
      // seed elapsedSeconds here or every timer shows its full duration.
      setElapsedSeconds(data.pausedElapsed ?? 0);
    } else {
      setSessionState('idle');
      setSessionStartTime(null);
      setPausedElapsed(0);
      setElapsedSeconds(0);
    }

    lastKnownUpdatedAtRef.current = data.updatedAt ?? null;
    lastSyncRef.current = syncKey(data);
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
    const seqAtStart = writeSeqRef.current;
    try {
      const res = await fetch('/api/active-session');
      if (!res.ok) return;
      const data = await res.json();
      // Local writes win over anything this response could be carrying — see
      // shouldApplyPolledSession. Without this, a poll racing "Clear all"
      // reloads the pre-clear task list and the cleared tasks come back.
      if (!shouldApplyPolledSession({
        writeSeqAtStart: seqAtStart,
        writeSeqNow: writeSeqRef.current,
        savePending: saveTimeoutRef.current !== null || queuedPayloadRef.current !== null || retryTimeoutRef.current !== null,
        saving: isSavingRef.current,
        responseUpdatedAt: data?.updatedAt ?? null,
        lastKnownUpdatedAt: lastKnownUpdatedAtRef.current,
      })) return;
      if (!data) {
        // Only reset to idle if we previously confirmed the session was saved to DB.
        // If save never succeeded (e.g. API error), don't kill the local session.
        if (sessionSavedToDbRef.current) {
          // Another device stopped the session. Mirror handleStop's local
          // cleanup: drop the done tasks and reset the envelope, otherwise the
          // next idle edit here re-saves the stale done list as a staged
          // session and undoes the stop on the device that issued it.
          sessionEpochRef.current += 1;
          setSessionState('idle');
          setSessionStartTime(null);
          setPausedElapsed(0);
          setElapsedSeconds(0);
          setTasks((prev: Task[]) => {
            const remaining = (prev ?? []).filter((t: Task) => !t?.isDone);
            const reset = recalculateCumulativeTimes(
              remaining.map((t: Task) => ({ ...(t ?? {}), isDone: false, doneAt: null, bonusSeconds: 0, completionLogId: null } as Task))
            );
            setSessionTotalSeconds(reset.length > 0 ? reset[reset.length - 1].cumulativeSeconds : 0);
            return reset;
          });
          soundPlayedRef.current = new Set();
          sessionSavedToDbRef.current = false;
          lastKnownUpdatedAtRef.current = null;
          lastSyncRef.current = '';
        }
        return;
      }

      if (syncKey(data) !== lastSyncRef.current) {
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
          setElapsedSeconds(data.pausedElapsed ?? 0);
        }
      }
    } catch (e: any) {
      // Silent fail on poll
    }
  };

  // Sends the newest queued payload. Runs only from saveChainRef so at most
  // one request is ever in flight; lastKnownUpdatedAt is read at send time so
  // it reflects whatever the previous send in the chain learned.
  const drainSaveQueue = useCallback(async () => {
    const payload = queuedPayloadRef.current;
    if (!payload) return;
    queuedPayloadRef.current = null;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    isSavingRef.current = true;
    let failed = false;
    try {
      const res = await fetch('/api/active-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, lastKnownUpdatedAt: lastKnownUpdatedAtRef.current }),
      });
      if (res.status === 409) {
        // Another device/tab saved since we last synced — adopt its state
        // instead of retrying this (now-stale) write over it.
        const conflictBody = await res.json().catch(() => null);
        if (conflictBody?.latest) {
          // Anything queued behind this send was computed from the same
          // pre-conflict local state, so it would overwrite the other device's
          // change on the next send. Remote wins: drop it too.
          queuedPayloadRef.current = null;
          applyRemoteSessionData(conflictBody.latest);
          toast.info('Synced with a more recent change from another device');
        }
      } else if (res.ok) {
        const saved = await res.json().catch(() => null);
        if (saved?.updatedAt) lastKnownUpdatedAtRef.current = saved.updatedAt;
        lastSyncRef.current = syncKey(payload);
        sessionSavedToDbRef.current = true;
        toast.dismiss('session-save-error');
      } else {
        failed = true;
      }
    } catch (e: any) {
      console.error('Failed to save session:', e);
      failed = true;
    } finally {
      isSavingRef.current = false;
    }
    if (failed && !queuedPayloadRef.current) {
      // Keep the unsent payload queued (so the poll guard treats local state
      // as authoritative rather than reverting it) and try again shortly.
      queuedPayloadRef.current = payload;
      toast.error("Couldn't save your session — retrying", { id: 'session-save-error' });
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        saveChainRef.current = saveChainRef.current.then(drainSaveQueue);
      }, SAVE_RETRY_DELAY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRemoteSessionData]);

  const enqueueSave = useCallback((payload: SessionPayload) => {
    queuedPayloadRef.current = payload;
    saveChainRef.current = saveChainRef.current.then(drainSaveQueue);
  }, [drainSaveQueue]);

  // Drops anything not yet sent. In-flight requests are left to finish; callers
  // that must run after them (e.g. the stop's DELETE) chain on saveChainRef.
  const cancelPendingSaves = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    queuedPayloadRef.current = null;
    toast.dismiss('session-save-error');
  }, []);

  const saveSessionToDb = useCallback((overrideTasks?: Task[], overrideState?: SessionState, overrideStartMs?: number | null, overridePausedElapsed?: number, overrideMode?: SessionMode, overrideTotalSeconds?: number) => {
    if (!isLoggedIn) return; // Don't save for guests
    writeSeqRef.current += 1;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      const currentStartMs = overrideStartMs !== undefined ? overrideStartMs : sessionStartTime;
      enqueueSave({
        tasks: overrideTasks ?? tasks,
        sessionState: overrideState ?? sessionState,
        sessionStartMs: currentStartMs ?? Date.now(),
        pausedElapsed: overridePausedElapsed !== undefined ? overridePausedElapsed : pausedElapsed,
        soundPlayed: Array.from(soundPlayedRef.current),
        sessionMode: overrideMode ?? sessionMode,
        sessionTotalSeconds: overrideTotalSeconds !== undefined ? overrideTotalSeconds : sessionTotalSeconds,
      });
    }, SAVE_DEBOUNCE);
  }, [isLoggedIn, tasks, sessionState, sessionStartTime, pausedElapsed, sessionMode, sessionTotalSeconds, enqueueSave]);

  // Immediate save for critical operations (bypasses debounce)
  const saveSessionToDbImmediate = useCallback((overrideTasks: Task[], overrideTotalSeconds: number, overrideState?: SessionState, overrideStartMs?: number | null, overridePausedElapsed?: number) => {
    if (!isLoggedIn) return;
    writeSeqRef.current += 1;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    const currentStartMs = overrideStartMs !== undefined ? overrideStartMs : sessionStartTime;
    enqueueSave({
      tasks: overrideTasks,
      sessionState: overrideState ?? sessionState,
      sessionStartMs: currentStartMs ?? Date.now(),
      pausedElapsed: overridePausedElapsed !== undefined ? overridePausedElapsed : pausedElapsed,
      soundPlayed: Array.from(soundPlayedRef.current),
      sessionMode: sessionMode,
      sessionTotalSeconds: overrideTotalSeconds,
    });
  }, [isLoggedIn, sessionState, sessionStartTime, pausedElapsed, sessionMode, enqueueSave]);

  // Cancels unsent saves, waits for any in-flight one, then deletes the row —
  // so a save that was already on the wire can't land after the DELETE and
  // resurrect the session.
  const deleteSessionFromDb = useCallback(async () => {
    if (!isLoggedIn) return;
    writeSeqRef.current += 1;
    cancelPendingSaves();
    await saveChainRef.current.catch(() => {});
    try {
      isSavingRef.current = true;
      await fetch('/api/active-session', { method: 'DELETE' });
      lastKnownUpdatedAtRef.current = null;
      lastSyncRef.current = '';
    } catch (e: any) {
      console.error('Failed to delete session:', e);
    } finally {
      isSavingRef.current = false;
    }
  }, [isLoggedIn, cancelPendingSaves]);

  // Clean up timers on unmount.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

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
        if (alarmEnabled) playTimerSound({ chime, volume: sessionVolume });
        saveSessionToDb();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSeconds, tasks, sessionState, alarmEnabled, chime, sessionVolume]);

  const handleStartSession = () => {
    if ((tasks?.length ?? 0) === 0) {
      toast.error('Add at least one task before starting');
      return;
    }
    soundPlayedRef.current = new Set();
    sessionSavedToDbRef.current = false;
    pendingOneOffBankTaskIdsRef.current.clear();
    pendingLogRef.current.clear();
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

  // Session-end sweep: hard-deletes bank tasks that are currently one-off on
  // the server and restores any soft-deleted rows that survived (e.g. checked
  // then unchecked while offline). Called even with an empty id list so the
  // restore pass always runs.
  const completeOneOffBankTasks = useCallback(async (bankTaskIds: string[]) => {
    if (!isLoggedIn) return;
    try {
      const res = await fetch('/api/task-bank/complete-one-offs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankTaskIds: bankTaskIds.filter(Boolean) }),
      });
      if (!res.ok) throw new Error(`Complete one-offs failed with ${res.status}`);
    } catch (e) {
      // This is the session-end sweep, so a swallowed failure leaves one-off
      // rows soft-deleted forever: hidden from the bank but never hard-deleted,
      // and nothing retries them. Worth telling the user about.
      console.error('Failed to complete one-off bank tasks:', e);
      toast.error("Couldn't finish clearing one-off tasks from your Task Bank", {
        id: 'bank-sync-error',
      });
    } finally {
      window.dispatchEvent(new Event('bank-tasks-updated'));
    }
  }, [isLoggedIn]);

  // Soft-delete toggle: checking a one-off done hides it from the bank
  // immediately; unchecking restores it. The server checks the live isOneOff
  // flag, so this is safe to call for any bank-linked task.
  // Same reasoning as stepGoalForBankTask below: a swallowed failure leaves the
  // task checked off in the session while the bank still shows it, with nothing
  // to explain the disagreement. A task that isn't one-off answers 200 with
  // { count: 0 }, so a non-ok status is always a real failure, never that no-op.
  const setOneOffChecked = useCallback(async (bankTaskIds: string[], done: boolean) => {
    const ids = bankTaskIds.filter(Boolean);
    if (!isLoggedIn || ids.length === 0) return;
    try {
      const res = await fetch('/api/task-bank/check-one-offs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankTaskIds: ids, done }),
      });
      if (!res.ok) throw new Error(`Check one-offs failed with ${res.status}`);
    } catch (e) {
      console.error('Failed to update one-off bank tasks:', e);
      toast.error(
        done
          ? "Couldn't remove the task from your Task Bank"
          : "Couldn't restore the task to your Task Bank",
        // Marking a task done fires this and the goal step together, so a shared
        // id per failure keeps one offline blip from stacking toasts.
        { id: 'bank-sync-error' }
      );
    } finally {
      window.dispatchEvent(new Event('bank-tasks-updated'));
    }
  }, [isLoggedIn]);

  // Advances or rolls back a goal by one interval when its cursor bank task is
  // completed/un-completed in a session. The server resolves the goal by
  // bankTaskId, so this is safe to call for any bank-linked task — non-goal
  // tasks are a no-op (same trust model as setOneOffChecked).
  // A failure here can't be silent: the task still shows as done locally, so
  // without a toast the goal just quietly doesn't move and the user has no way
  // to tell. The refresh event fires either way — on failure it resyncs the
  // card to the server's (unchanged) progress rather than leaving it stale.
  const stepGoalForBankTask = useCallback(async (bankTaskId: string, direction: 'advance' | 'retreat') => {
    if (!isLoggedIn || !bankTaskId) return;
    try {
      const res = await fetch('/api/goals/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankTaskId, direction }),
      });
      // A task that isn't a goal cursor still answers 200 with { goal: null },
      // so a non-ok status is always a real failure, never the no-op case.
      if (!res.ok) throw new Error(`Goal step failed with ${res.status}`);
    } catch (e) {
      console.error('Failed to step goal:', e);
      toast.error(
        direction === 'advance'
          ? "Couldn't update goal progress — it may be out of date"
          : "Couldn't roll back goal progress — it may be out of date",
        { id: 'goal-step-error' }
      );
    } finally {
      window.dispatchEvent(new Event('bank-tasks-updated'));
    }
  }, [isLoggedIn]);

  // Retracts a completion-log entry — used when a task is un-marked as done,
  // so toggling done -> undone -> done doesn't leave a duplicate stats entry behind.
  const retractCompletionLog = useCallback(async (completionLogId: string) => {
    if (isLoggedIn) {
      try {
        const res = await fetch('/api/completion-log', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: completionLogId }),
        });
        if (!res.ok) throw new Error(`Retract completion log failed with ${res.status}`);
      } catch (e) {
        // A silent failure here leaves a stats entry for work the user just
        // un-marked, and re-marking it done logs a second one — so the history
        // over-counts with no sign anything went wrong.
        console.error('Failed to retract completion log:', e);
        toast.error("Couldn't remove that task from your history", {
          id: 'completion-log-error',
        });
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

    // Snapshot the done tasks before clearing state so we can sweep their bank
    // rows at session end. This is both the authoritative cleanup moment and a
    // retry for any check-off that failed earlier.
    const doneBankTaskIds = (tasks ?? [])
      .filter((t: Task) => t?.isDone && t?.bankTaskId)
      .map((t: Task) => t.bankTaskId as string);
    const bankTaskIdsToSweep = Array.from(
      new Set([...doneBankTaskIds, ...pendingOneOffBankTaskIdsRef.current])
    );

    // Invalidate every callback still pending from this session (debounced
    // saves, the completion-log id attach) before touching state, so none of
    // them can re-save a 'running' snapshot after the row is gone.
    sessionEpochRef.current += 1;
    cancelPendingSaves();

    // On stop, filter out done tasks so only unfinished ones remain.
    const remaining = recalculateCumulativeTimes(
      (tasks ?? [])
        .filter((t: Task) => !t?.isDone)
        .map((t: Task) => ({ ...(t ?? {}), isDone: false, doneAt: null, bonusSeconds: 0, completionLogId: null } as Task))
    );
    const remainingTotal = remaining.length > 0 ? remaining[remaining.length - 1].cumulativeSeconds : 0;

    setSessionState('idle');
    setSessionStartTime(null);
    setPausedElapsed(0);
    setElapsedSeconds(0);
    setSessionTotalSeconds(remainingTotal);
    soundPlayedRef.current = new Set();
    setTasks(remaining);

    if (remaining.length > 0) {
      // Persist the leftovers as a staged (idle) list, the same way idle edits
      // are saved, so they survive a refresh. Other devices see the idle row on
      // their next poll and drop out of the session too.
      sessionSavedToDbRef.current = false;
      saveSessionToDbImmediate(remaining, remainingTotal, 'idle', null, 0);
    } else {
      deleteSessionFromDb();
    }
    completeOneOffBankTasks(bankTaskIdsToSweep);
    pendingOneOffBankTaskIdsRef.current.clear();
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
      const pending = pendingLogRef.current.get(taskId);
      if (task.completionLogId) {
        retractCompletionLog(task.completionLogId);
      } else if (pending && !pending.cancelled) {
        // The log request hasn't answered yet, so there's no id to retract.
        // Cancel the attach and retract as soon as the id arrives — otherwise
        // the entry is orphaned and re-marking logs a second one.
        pending.cancelled = true;
        pending.promise.then((idMap) => {
          const logId = idMap[taskId];
          if (logId) retractCompletionLog(logId);
        });
      }
      // Restore the soft-deleted bank row so an accidental check-off doesn't
      // keep the task hidden from the bank.
      if (task.bankTaskId) {
        setOneOffChecked([task.bankTaskId], false);
        stepGoalForBankTask(task.bankTaskId, 'retreat');
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

    // Soft-delete the bank row so the one-off disappears from the bank right
    // away. The hard delete waits for session end, so unchecking can undo this.
    if (task.bankTaskId) {
      setOneOffChecked([task.bankTaskId], true);
      stepGoalForBankTask(task.bankTaskId, 'advance');
    }

    const epoch = sessionEpochRef.current;
    const promise = logCompletedTasks([{ ...task, isDone: true, doneAt }]);
    const entry = { promise, cancelled: false };
    pendingLogRef.current.set(taskId, entry);
    promise.then((idMap) => {
      if (pendingLogRef.current.get(taskId) === entry) pendingLogRef.current.delete(taskId);
      // Un-marked while the request was out (handled there), or the session
      // ended: nothing to attach, and saving here would resurrect the session.
      if (entry.cancelled || sessionEpochRef.current !== epoch) return;
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
          // Prepend and recalculate all cumulative times while preserving the
          // continuous session envelope, so existing deadlines don't collapse
          // toward zero mid-session.
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
          const newTotalSeconds = effectiveTotal + durationSeconds;
          const { tasks: updated } = recalculateCumulativeTimesWithEnvelope([newTask, ...list], newTotalSeconds);
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
        // Idle: full recalculation
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
  const handleAddFromBank = (picked: PickedBankTask[]) => {
    if (picked.length === 0) return;
    const isActiveContinuous = sessionState !== 'idle' && sessionMode === 'continuous';

    setTasks((prev: Task[]) => {
      const list = prev ?? [];

      if (isActiveContinuous) {
        let effectiveTotal = sessionTotalSeconds;
        if (effectiveTotal <= 0 && list.length > 0) {
          effectiveTotal = list[list.length - 1]?.cumulativeSeconds ?? 0;
        }
        let running = effectiveTotal;
        const newTasks: Task[] = picked.map((p) => {
          const bt = p.bankTask;
          running += bt.durationSeconds;
          return {
            id: generateId(),
            name: p.name ?? bt.name,
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

      // Idle: full recalculation
      const newTasks: Task[] = picked.map((p) => {
        const bt = p.bankTask;
        return {
          id: generateId(),
          name: p.name ?? bt.name,
          durationSeconds: bt.durationSeconds,
          cumulativeSeconds: 0,
          isDone: false,
          doneAt: null,
          bonusSeconds: 0,
          color: bt.color,
          bankTaskId: bt.id,
          isOneOffBankTask: bt.isOneOff,
        };
      });
      const updated = recalculateCumulativeTimes([...list, ...newTasks]);
      // Persist regardless of session state — see the comment in handleAddTask.
      const newTotal = updated.length > 0 ? updated[updated.length - 1].cumulativeSeconds : 0;
      setSessionTotalSeconds(newTotal);
      saveSessionToDb(updated, undefined, undefined, undefined, undefined, newTotal);
      return updated;
    });

    toast.success(`Added ${picked.length} task${picked.length !== 1 ? 's' : ''} from bank`);
  };

  const handleDeleteTask = (taskId: string) => {
    const isActive = sessionState !== 'idle';
    const deletedTask = (tasks ?? []).find((t: Task) => t?.id === taskId);

    // In continuous mode during an active session, treat delete as "mark done" and remove from list
    if (isActive) {
      const filtered = (tasks ?? []).filter((t: Task) => t?.id !== taskId);
      setTasks(filtered);
      saveSessionToDb(filtered);
      // Log outside the updater — this creates a DB row, so it must fire exactly once.
      if (deletedTask && !deletedTask.isDone) {
        logCompletedTasks([{ ...deletedTask, isDone: true, doneAt: Date.now() }]);
      }
      // Queue any bank task id for the session-end sweep, since the task is
      // leaving the list and won't be caught by the isDone scan at stop time.
      // Also soft-delete right away — removal counts as completion and can't
      // be unchecked, so the row should vanish from the bank immediately.
      if (deletedTask?.bankTaskId) {
        pendingOneOffBankTaskIdsRef.current.add(deletedTask.bankTaskId);
        setOneOffChecked([deletedTask.bankTaskId], true);
        // Removal during an active session counts as completion, so a goal
        // cursor advances here too — unless it was already marked done, in
        // which case the advance fired in handleMarkDone.
        if (!deletedTask.isDone) {
          stepGoalForBankTask(deletedTask.bankTaskId, 'advance');
        }
      }
      return;
    }

    // Idle: actually remove the task and recalculate.
    // Persisted regardless of isActive so a staged pre-session list survives a refresh.
    const filtered = (tasks ?? []).filter((t: Task) => t?.id !== taskId);
    const updated = recalculateCumulativeTimes(filtered);
    setTasks(updated);
    saveSessionToDb(updated);
  };

  // Clears every task from the list at once. Unlike looping handleDeleteTask,
  // this is a single state update — calling onDeleteTask repeatedly would
  // re-read stale `tasks` from the closure and only remove one task.
  const handleClearAll = () => {
    const isActive = sessionState !== 'idle';
    const currentTasks = (tasks ?? []).filter((t: Task) => t?.id);

    if (isActive) {
      setTasks([]);
      saveSessionToDb([]);

      // Log every task that wasn't already marked done as completed.
      const notDone = currentTasks.filter((t: Task) => !t.isDone);
      if (notDone.length > 0) {
        logCompletedTasks(notDone.map((t: Task) => ({ ...t, isDone: true, doneAt: Date.now() })));
      }

      // Queue bank task ids for the session-end sweep and soft-delete one-offs
      // immediately, mirroring handleDeleteTask. Goals advance only for tasks
      // that weren't already done (done ones advanced in handleMarkDone).
      currentTasks.forEach((t: Task) => {
        if (!t.bankTaskId) return;
        pendingOneOffBankTaskIdsRef.current.add(t.bankTaskId);
        setOneOffChecked([t.bankTaskId], true);
        if (!t.isDone) {
          stepGoalForBankTask(t.bankTaskId, 'advance');
        }
      });
      return;
    }

    // Idle: clear the list and reset the total.
    setTasks([]);
    setSessionTotalSeconds(0);
    saveSessionToDb([]);
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

      // Idle: full recalculation. Persisted regardless of
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
        // Guard: if sessionTotalSeconds is 0/unset (legacy session or migration),
        // derive it from the last task's cumulative time in prevTasks
        let effectiveTotal = sessionTotalSeconds;
        if (effectiveTotal <= 0 && prevTasks.length > 0) {
          effectiveTotal = prevTasks[prevTasks.length - 1]?.cumulativeSeconds ?? 0;
          console.warn('[handleReorder] sessionTotalSeconds was 0, derived from prevTasks:', effectiveTotal);
        }

        const { tasks: updated, effectiveEnvelopeSeconds } = recalculateCumulativeTimesWithEnvelope(newTasks, effectiveTotal);

        // If sessionTotalSeconds was wrong, fix it in state too
        if (sessionTotalSeconds !== effectiveEnvelopeSeconds) {
          setSessionTotalSeconds(effectiveEnvelopeSeconds);
        }

        // Save immediately (bypass debounce to prevent race)
        saveSessionToDbImmediate(updated, effectiveEnvelopeSeconds);
        return updated;
      });
      return;
    }

    // IDLE: full recalculation, sessionTotalSeconds = sum of
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
    handleClearAll,
    handleEditTask,
    handleReorder,
  };
}
