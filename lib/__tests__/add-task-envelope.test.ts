/**
 * Regression tests for mid-session "add to top" in continuous mode.
 *
 * Adding a task at the top used to call recalculateCumulativeTimes, which
 * re-anchors every cumulative at zero. In a continuous session with gaps
 * (deleted/completed tasks or buffer time), deadlines should stay anchored
 * to the session envelope instead.
 */

import { recalculateCumulativeTimesWithEnvelope } from '../timer-utils';

interface Task {
  id: string;
  name: string;
  durationSeconds: number;
  cumulativeSeconds: number;
  isDone: boolean;
  doneAt: number | null;
  bonusSeconds: number;
  color: 'orange' | 'blue' | 'green' | 'purple' | 'pink';
}

function t(id: string, durationSeconds: number, cumulativeSeconds: number): Task {
  return {
    id,
    name: `Task ${id}`,
    durationSeconds,
    cumulativeSeconds,
    isDone: false,
    doneAt: null,
    bonusSeconds: 0,
    color: 'orange',
  };
}

function sessionTotal(tasks: Task[]): number {
  return tasks.length > 0 ? tasks[tasks.length - 1].cumulativeSeconds : 0;
}

/** Mirrors the continuous-mode top-insert branch of handleAddTask. */
function addTaskToTop(
  list: Task[],
  sessionTotalSeconds: number,
  durationSeconds: number
): { tasks: Task[]; newTotalSeconds: number } {
  const effectiveTotal =
    sessionTotalSeconds <= 0 && list.length > 0
      ? list[list.length - 1].cumulativeSeconds
      : sessionTotalSeconds;

  const newTask: Task = {
    id: 'new',
    name: 'New task',
    durationSeconds,
    cumulativeSeconds: 0,
    isDone: false,
    doneAt: null,
    bonusSeconds: 0,
    color: 'orange',
  };

  const newTotalSeconds = effectiveTotal + durationSeconds;
  const { tasks: updated } = recalculateCumulativeTimesWithEnvelope(
    [newTask, ...list],
    newTotalSeconds
  );

  return { tasks: updated, newTotalSeconds };
}

describe('Continuous mode — add task to top preserves session envelope', () => {
  test('top-insert with a gap keeps existing deadlines anchored', () => {
    // A(600,600) C(600,1500) — B was deleted, leaving a 300s gap.
    // Session envelope is 1500s.
    const list = [t('A', 600, 600), t('C', 600, 1500)];
    const { tasks, newTotalSeconds } = addTaskToTop(list, 1500, 300);

    expect(newTotalSeconds).toBe(1800);
    expect(sessionTotal(tasks)).toBe(1800);

    // New task is first, then A, then C.
    // baseOffset = 1800 - (300 + 600 + 600) = 300
    expect(tasks[0].id).toBe('new');
    expect(tasks[0].cumulativeSeconds).toBe(600); // 300 + 300
    expect(tasks[1].id).toBe('A');
    expect(tasks[1].cumulativeSeconds).toBe(1200); // 600 + 600
    expect(tasks[2].id).toBe('C');
    expect(tasks[2].cumulativeSeconds).toBe(1800); // 1200 + 600
  });

  test('top-insert without a gap behaves like a normal prepend', () => {
    const list = [t('A', 600, 600), t('B', 300, 900)];
    const { tasks, newTotalSeconds } = addTaskToTop(list, 900, 200);

    expect(newTotalSeconds).toBe(1100);
    expect(sessionTotal(tasks)).toBe(1100);

    expect(tasks[0].cumulativeSeconds).toBe(200);
    expect(tasks[1].cumulativeSeconds).toBe(800);
    expect(tasks[2].cumulativeSeconds).toBe(1100);
  });

  test('top-insert keeps deadlines in the future when elapsed time exceeds duration sum', () => {
    // Session has run for 2000s, but only two 600s tasks remain (1200s of work).
    // The envelope of 2000s must be preserved so remaining time stays positive.
    const list = [t('A', 600, 2600), t('B', 600, 3200)];
    const sessionTotalSeconds = 3200;
    const { tasks, newTotalSeconds } = addTaskToTop(list, sessionTotalSeconds, 300);

    expect(newTotalSeconds).toBe(3500);
    expect(sessionTotal(tasks)).toBe(3500);

    // baseOffset = 3500 - (300 + 600 + 600) = 2000
    expect(tasks[0].cumulativeSeconds).toBe(2300);
    expect(tasks[1].cumulativeSeconds).toBe(2900);
    expect(tasks[2].cumulativeSeconds).toBe(3500);
  });
});
