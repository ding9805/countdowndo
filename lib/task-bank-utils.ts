import { BankTask, TaskBankSortMode } from './types';

export const TASK_BANK_SORT_MODES = ['recent', 'due', 'alpha'] as const;

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
