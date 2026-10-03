import { BankTask, Task, TASK_COLORS, TaskBankSortMode } from './types';

export const TASK_BANK_SORT_MODES = ['recent', 'due', 'alpha', 'tag', 'color'] as const;

export function sortBankTasks(tasks: BankTask[], mode: TaskBankSortMode): BankTask[] {
  const sorted = [...tasks];

  switch (mode) {
    case 'recent':
      sorted.sort((a, b) => {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
      break;

    case 'alpha':
      sorted.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      });
      break;

    case 'tag': {
      const alphaCmp = (a: BankTask, b: BankTask) => {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      };
      const firstTag = (task: BankTask) => [...task.tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))[0] ?? '';

      sorted.sort((a, b) => {
        const aTag = firstTag(a);
        const bTag = firstTag(b);
        if (!aTag && bTag) return 1;
        if (aTag && !bTag) return -1;
        const cmp = aTag.localeCompare(bTag, undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : alphaCmp(a, b);
      });
      break;
    }

    case 'due': {
      const alphaCmp = (a: BankTask, b: BankTask) => {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      };

      sorted.sort((a, b) => {
        if (a.dueDate && b.dueDate) {
          const cmp = a.dueDate.localeCompare(b.dueDate);
          return cmp !== 0 ? cmp : alphaCmp(a, b);
        }
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
      break;
    }

    case 'color': {
      const alphaCmp = (a: BankTask, b: BankTask) => {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      };
      const colorIndex = (task: BankTask) => TASK_COLORS.findIndex((color) => color.id === task.color);

      sorted.sort((a, b) => {
        const cmp = colorIndex(a) - colorIndex(b);
        return cmp !== 0 ? cmp : alphaCmp(a, b);
      });
      break;
    }
  }

  return sorted;
}

export function dueDayDiff(due: string, now?: Date): number {
  const [y, m, d] = due.split('-').map(Number);
  const dueDate = new Date(y, m - 1, d);
  const nowDate = now ?? new Date();
  const nowMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  return Math.round((dueDate.getTime() - nowMidnight.getTime()) / 86_400_000);
}

export function isOverdue(due: string | null | undefined, now?: Date): boolean {
  if (!due) return false;
  return dueDayDiff(due, now) < 0;
}

export function formatDueDate(due: string, now?: Date): string {
  const diff = dueDayDiff(due, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';

  const [y, m, d] = due.split('-').map(Number);
  const dueDate = new Date(y, m - 1, d);
  const nowDate = now ?? new Date();

  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (y !== nowDate.getFullYear()) {
    options.year = 'numeric';
  }
  return dueDate.toLocaleDateString(undefined, options);
}

// How many copies of each bank task are still waiting to be done in a
// session, by bank task id. Done copies don't count: each one has already
// advanced its goal, so the goal's remaining chunks no longer include it, and
// a done one-off has already left the bank.
export function countQueuedBankCopies(tasks: Pick<Task, 'bankTaskId' | 'isDone'>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  tasks.forEach((task) => {
    if (task.bankTaskId && !task.isDone) counts[task.bankTaskId] = (counts[task.bankTaskId] ?? 0) + 1;
  });
  return counts;
}

// Undoing one optimistic change when its request fails. Each touches only the
// row that change made, so whatever else happened while the request was out
// (another row added, edited or deleted) stays as it is.

// A failed create: take out its placeholder row.
export function withoutRow<T extends { id: string }>(rows: T[], id: string): T[] {
  return rows.filter((row) => row.id !== id);
}

// A failed edit: put the row back as it was, unless it has changed again since.
export function revertRow<T extends { id: string }>(rows: T[], edited: T, original: T): T[] {
  return rows.map((row) => (row === edited ? original : row));
}

// A failed delete: put the row back where it was, unless it's back already.
export function restoreRow<T extends { id: string }>(rows: T[], removed: T, index: number): T[] {
  if (rows.some((row) => row.id === removed.id)) return rows;
  const at = Math.min(Math.max(index, 0), rows.length);
  return [...rows.slice(0, at), removed, ...rows.slice(at)];
}
