import { Task } from './types';

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

export function recalculateCumulativeTimes(tasks: Task[]): Task[] {
  let cumulative = 0;
  return (tasks ?? []).map((task: Task) => {
    cumulative += task?.durationSeconds ?? 0;
    return { ...(task ?? {}), cumulativeSeconds: cumulative } as Task;
  });
}

/**
 * Re-derive cumulative times while preserving a continuous session's envelope.
 *
 * In continuous mode the session end time can be larger than the sum of task
 * durations (because of deleted/completed tasks or added buffer time). Instead
 * of anchoring every cumulative at zero, this anchors the first task at
 * `envelopeSeconds - sumOfDurations` so the last task ends exactly at the
 * envelope.
 */
export function recalculateCumulativeTimesWithEnvelope(
  tasks: Task[],
  envelopeSeconds: number
): { tasks: Task[]; effectiveEnvelopeSeconds: number } {
  const sumOfDurations = (tasks ?? []).reduce(
    (sum: number, t: Task) => sum + (t?.durationSeconds ?? 0),
    0
  );
  const effectiveEnvelope = Math.max(sumOfDurations, envelopeSeconds);
  const baseOffset = effectiveEnvelope - sumOfDurations;
  let cumulative = baseOffset;
  const updated = (tasks ?? []).map((task: Task) => {
    cumulative += task?.durationSeconds ?? 0;
    return { ...(task ?? {}), cumulativeSeconds: cumulative } as Task;
  });
  return { tasks: updated, effectiveEnvelopeSeconds: effectiveEnvelope };
}

export function formatTime(totalSeconds: number): string {
  const abs = Math.abs(totalSeconds ?? 0);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const sign = (totalSeconds ?? 0) < 0 ? '-' : '';

  if (hours > 0) {
    return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = totalSeconds ?? 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * The task list a stopped session leaves staged for the next one: the
 * unfinished tasks only, with per-run state (done flags, bonus time, the
 * completion-log id) cleared and cumulative times re-anchored at zero.
 *
 * Pulled out of handleStop so the staged list can be persisted as well as
 * shown — the DB row is deleted at session end, so anything left in local
 * state alone is lost on the next refresh.
 */
export function resetTasksForNextSession(tasks: Task[]): Task[] {
  return recalculateCumulativeTimes(
    (tasks ?? [])
      .filter((task: Task) => !task?.isDone)
      .map(
        (task: Task) =>
          ({ ...(task ?? {}), isDone: false, doneAt: null, bonusSeconds: 0, completionLogId: null }) as Task
      )
  );
}

/** The session envelope implied by a list: the last task's cumulative time. */
export function sessionTotalFor(tasks: Task[]): number {
  const list = tasks ?? [];
  return list.length > 0 ? (list[list.length - 1]?.cumulativeSeconds ?? 0) : 0;
}
