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
