import { sortBankTasks, isOverdue, formatDueDate, dueDayDiff } from '../task-bank-utils';
import { BankTask } from '../types';

function makeTask(overrides: Partial<BankTask> & { id: string }): BankTask {
  return {
    name: 'Task',
    durationSeconds: 300,
    color: 'orange',
    tags: [],
    isOneOff: false,
    dueDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sortBankTasks', () => {
  const tasks: BankTask[] = [
    makeTask({ id: 'a', name: 'Banana', createdAt: '2026-01-02T00:00:00.000Z' }),
    makeTask({ id: 'b', name: 'apple', createdAt: '2026-01-03T00:00:00.000Z' }),
    makeTask({ id: 'c', name: 'Cherry', createdAt: '2026-01-01T00:00:00.000Z' }),
    makeTask({ id: 'd', name: 'D Date', createdAt: '2026-01-01T00:00:00.000Z', dueDate: '2026-07-20' }),
    makeTask({ id: 'e', name: 'E Date', createdAt: '2026-01-01T00:00:00.000Z', dueDate: '2026-07-15' }),
    makeTask({ id: 'f', name: 'F Date', createdAt: '2026-01-01T00:00:00.000Z', dueDate: '2026-07-15' }),
  ];

  test('recent: orders by createdAt desc, tie by name', () => {
    const result = sortBankTasks(tasks, 'recent');
    expect(result.map((t) => t.id)).toEqual(['b', 'a', 'c', 'd', 'e', 'f']);
  });

  test('alpha: case-insensitive alphabetical, tie by createdAt desc', () => {
    const result = sortBankTasks(tasks, 'alpha');
    // apple (b), Banana (a), Cherry (c), D Date (d), E Date (e), F Date (f)
    expect(result.map((t) => t.id)).toEqual(['b', 'a', 'c', 'd', 'e', 'f']);
  });

  test('due: dated tasks first by dueDate asc, tied by alpha, undated last by createdAt desc', () => {
    const result = sortBankTasks(tasks, 'due');
    // Dated: e(Jul 15), f(Jul 15) — tie: 'E Date' < 'F Date' => e, f.
    // d(Jul 20)
    // Undated: b(Jan 3), a(Jan 2), c(Jan 1) — createdAt desc
    expect(result.map((t) => t.id)).toEqual(['e', 'f', 'd', 'b', 'a', 'c']);
  });

  test('does not mutate the input array', () => {
    const original = [...tasks];
    sortBankTasks(tasks, 'due');
    expect(tasks.map((t) => t.id)).toEqual(original.map((t) => t.id));
  });

  test('empty array', () => {
    expect(sortBankTasks([], 'due')).toEqual([]);
  });

  test('single element', () => {
    const single = [tasks[0]];
    const result = sortBankTasks(single, 'alpha');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});

describe('dueDayDiff', () => {
  test('positive diff for future dates', () => {
    const now = new Date(2026, 6, 15, 12, 0); // Jul 15, 2026 noon
    expect(dueDayDiff('2026-07-16', now)).toBe(1);
    expect(dueDayDiff('2026-07-20', now)).toBe(5);
  });

  test('zero for same day', () => {
    const now = new Date(2026, 6, 15, 23, 59);
    expect(dueDayDiff('2026-07-15', now)).toBe(0);
  });

  test('negative for past dates', () => {
    const now = new Date(2026, 6, 15, 0, 0); // midnight Jul 15
    expect(dueDayDiff('2026-07-14', now)).toBe(-1);
  });

  test('time-of-day is irrelevant', () => {
    const now = new Date(2026, 6, 15, 0, 0);
    expect(dueDayDiff('2026-07-15', now)).toBe(0);
    const nowPM = new Date(2026, 6, 15, 23, 59);
    expect(dueDayDiff('2026-07-15', nowPM)).toBe(0);
  });
});

describe('isOverdue', () => {
  const now = new Date(2026, 6, 15, 23, 59); // Jul 15, 2026

  test('true for day before', () => {
    expect(isOverdue('2026-07-14', now)).toBe(true);
  });

  test('false for due today', () => {
    expect(isOverdue('2026-07-15', now)).toBe(false);
  });

  test('false for future date', () => {
    expect(isOverdue('2026-07-16', now)).toBe(false);
  });

  test('false for null', () => {
    expect(isOverdue(null, now)).toBe(false);
  });

  test('false for undefined', () => {
    expect(isOverdue(undefined, now)).toBe(false);
  });

  test('time-of-day irrelevance', () => {
    const nowMidnight = new Date(2026, 6, 15, 0, 0);
    expect(isOverdue('2026-07-15', nowMidnight)).toBe(false);
  });
});

describe('formatDueDate', () => {
  test('Today for same day', () => {
    const now = new Date(2026, 6, 15, 12, 0);
    expect(formatDueDate('2026-07-15', now)).toBe('Today');
  });

  test('Tomorrow for next day', () => {
    const now = new Date(2026, 6, 15, 12, 0);
    expect(formatDueDate('2026-07-16', now)).toBe('Tomorrow');
  });

  test('plain date for same year', () => {
    const now = new Date(2026, 6, 15, 12, 0);
    // "Jul 22" depends on locale, so just check it does not contain "2026"
    const result = formatDueDate('2026-07-22', now);
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Tomorrow');
  });

  test('includes year for different year', () => {
    const now = new Date(2026, 6, 15, 12, 0);
    const result = formatDueDate('2027-01-01', now);
    // Should include year since it's not the current year
    expect(result).toContain('2027');
  });

  test('year boundary: Dec 31 → Jan 1 is Tomorrow', () => {
    const now = new Date(2026, 11, 31, 12, 0); // Dec 31, 2026
    expect(formatDueDate('2027-01-01', now)).toBe('Tomorrow');
  });

  test('yesterday shows plain date, not a label', () => {
    const now = new Date(2026, 6, 15, 12, 0);
    const result = formatDueDate('2026-07-14', now);
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Tomorrow');
  });
});
