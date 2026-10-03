/**
 * Regression tests for adding a task to a continuous session under way.
 *
 * Adding a task at the top used to call recalculateCumulativeTimes, which
 * re-anchors every cumulative at zero. In a continuous session with gaps
 * (deleted/completed tasks or buffer time), deadlines should stay anchored
 * to the session envelope instead.
 *
 * It then timed the new task from the session's start rather than from now,
 * so partway through a session it started out overdue (and chimed at once),
 * above the tasks already done. It now goes below those and starts now, or
 * where the task before it ends if that's later. "Add to Bottom" in a
 * session that has run over had the same problem.
 */

import { addTaskMidSession } from '../timer-utils';
import type { Task } from '../types';

function t(id: string, durationSeconds: number, cumulativeSeconds: number, isDone = false): Task {
  return {
    id,
    name: `Task ${id}`,
    durationSeconds,
    cumulativeSeconds,
    isDone,
    doneAt: null,
    bonusSeconds: 0,
    color: 'orange',
  };
}

const newTask = (durationSeconds: number) => t('new', durationSeconds, 0);

// [id, deadline] pairs, in list order.
const deadlines = (tasks: Task[]) => tasks.map((task) => [task.id, task.cumulativeSeconds]);

describe('Continuous mode — add task to top preserves session envelope', () => {
  test('top-insert with a gap keeps existing deadlines anchored', () => {
    // A(600,600) C(600,1500) — B was deleted, leaving a 300s gap.
    // Session envelope is 1500s, and A is under way.
    const list = [t('A', 600, 600), t('C', 600, 1500)];
    const result = addTaskMidSession(list, newTask(300), 'top', 100, 1500);

    // Everything after the new task moves back by its duration; the gap stays.
    expect(deadlines(result.tasks)).toEqual([['new', 400], ['A', 900], ['C', 1800]]);
    expect(result.envelopeSeconds).toBe(1800);
  });

  test('top-insert without a gap behaves like a normal prepend', () => {
    const list = [t('A', 600, 600), t('B', 300, 900)];
    const result = addTaskMidSession(list, newTask(200), 'top', 0, 900);

    expect(deadlines(result.tasks)).toEqual([['new', 200], ['A', 800], ['B', 1100]]);
    expect(result.envelopeSeconds).toBe(1100);
  });

  test('top-insert keeps deadlines in the future when elapsed time exceeds duration sum', () => {
    // Session has run for 2000s, but only two 600s tasks remain (1200s of work).
    // The envelope of 2000s must be preserved so remaining time stays positive.
    const list = [t('A', 600, 2600), t('B', 600, 3200)];
    const result = addTaskMidSession(list, newTask(300), 'top', 2000, 3200);

    expect(deadlines(result.tasks)).toEqual([['new', 2300], ['A', 2900], ['B', 3500]]);
    expect(result.envelopeSeconds).toBe(3500);
  });
});

describe('Continuous mode — a task added mid-session never starts out overdue', () => {
  test('at the top, it gets its full duration from now and the current task keeps what it had left', () => {
    // Five minutes into a 10-minute task.
    const result = addTaskMidSession([t('A', 600, 600)], newTask(300), 'top', 300, 600);

    expect(deadlines(result.tasks)).toEqual([['new', 600], ['A', 900]]);
  });

  test('it goes below the tasks already done, and gets the time one finished early left over', () => {
    // A was done at 400s, 200s early; B is next.
    const list = [t('A', 600, 600, true), t('B', 600, 1200)];
    const result = addTaskMidSession(list, newTask(300), 'top', 400, 1200);

    expect(deadlines(result.tasks)).toEqual([['A', 600], ['new', 900], ['B', 1500]]);
  });

  test('a task already overdue moves to the end of the new one, keeping deadlines in order', () => {
    // A is two minutes overdue.
    const result = addTaskMidSession([t('A', 600, 600)], newTask(300), 'top', 720, 600);

    expect(deadlines(result.tasks)).toEqual([['new', 1020], ['A', 1020]]);
    expect(result.envelopeSeconds).toBe(1020);
  });

  test('at the bottom, it starts at the session end, or now if the session has run over', () => {
    const list = [t('A', 600, 600)];

    expect(deadlines(addTaskMidSession(list, newTask(300), 'bottom', 100, 600).tasks))
      .toEqual([['A', 600], ['new', 900]]);

    const overtime = addTaskMidSession(list, newTask(300), 'bottom', 960, 600);
    expect(deadlines(overtime.tasks)).toEqual([['A', 600], ['new', 1260]]);
    expect(overtime.envelopeSeconds).toBe(1260);
  });

  test('at the top with every task done, it goes at the end like a bottom add', () => {
    const list = [t('A', 600, 600, true)];

    expect(addTaskMidSession(list, newTask(300), 'top', 400, 900))
      .toEqual(addTaskMidSession(list, newTask(300), 'bottom', 400, 900));
  });
});
