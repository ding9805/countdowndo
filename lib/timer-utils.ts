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

/**
 * Add a task to a continuous session that's under way.
 *
 * 'top' means do it next: it goes just below the tasks already done, which
 * stay where they are as a record (same as Move to top), and 'bottom' after
 * everything, at the session's end. Either way it starts where the task
 * before it ends, or now if that's already past, so it never starts out
 * overdue. The tasks after it move back by its duration, and any whose
 * deadline had already passed moves to its end, so deadlines stay in order.
 */
export function addTaskMidSession(
  tasks: Task[],
  task: Task,
  position: 'top' | 'bottom',
  elapsedSeconds: number,
  envelopeSeconds: number
): { tasks: Task[]; envelopeSeconds: number } {
  const list = tasks ?? [];
  const firstNotDone = list.findIndex((t: Task) => !t?.isDone);
  const index = position === 'top' && firstNotDone >= 0 ? firstNotDone : list.length;
  const previousEnd = index === list.length
    ? envelopeSeconds
    : (list[index - 1]?.cumulativeSeconds ?? 0);
  const start = Math.max(elapsedSeconds, previousEnd);
  const duration = task?.durationSeconds ?? 0;
  const later = list.slice(index).map((t: Task) => (
    { ...(t ?? {}), cumulativeSeconds: Math.max(t?.cumulativeSeconds ?? 0, start) + duration } as Task
  ));
  return {
    tasks: [...list.slice(0, index), { ...task, cumulativeSeconds: start + duration }, ...later],
    envelopeSeconds: Math.max(envelopeSeconds, start) + duration,
  };
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
