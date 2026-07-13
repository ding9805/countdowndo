// Fixed palette of 5 task colours
export const TASK_COLORS = [
  { id: 'orange',  hex: '#F97316', label: 'Orange' },
  { id: 'blue',    hex: '#3B82F6', label: 'Blue' },
  { id: 'green',   hex: '#22C55E', label: 'Green' },
  { id: 'purple',  hex: '#A855F7', label: 'Purple' },
  { id: 'pink',    hex: '#EC4899', label: 'Pink' },
] as const;

export type TaskColorId = typeof TASK_COLORS[number]['id'];

export interface Task {
  id: string;
  name: string;
  durationSeconds: number;
  cumulativeSeconds: number;
  isDone: boolean;
  doneAt: number | null; // timestamp when marked done
  bonusSeconds: number; // extra seconds received from early completion of previous tasks
  color: TaskColorId;
  // The completion-log entry created when this task was marked done, so
  // un-marking it can retract that entry instead of leaving a duplicate
  // behind if it's marked done again later.
  completionLogId?: string | null;
  // If this task was imported from the task bank, track its bank ID and whether
  // it's one-off so we can delete it from the bank if completed or removed
  bankTaskId?: string | null;
  isOneOffBankTask?: boolean;
}

export interface BankTask {
  id: string;
  name: string;
  durationSeconds: number;
  color: TaskColorId;
  tags: string[];
  isOneOff: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankTaskTemplate {
  id: string;
  name: string;
  durationSeconds: number;
  color: TaskColorId;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type SessionState = 'idle' | 'running' | 'paused';
export type SessionMode = 'continuous' | 'sprint';
export type TaskOrder = 'desc' | 'asc';

export function getTaskColorHex(colorId: TaskColorId | string | undefined): string {
  const found = TASK_COLORS.find((c) => c.id === colorId);
  return found?.hex ?? TASK_COLORS[0].hex;
}
