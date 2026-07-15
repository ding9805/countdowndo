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
