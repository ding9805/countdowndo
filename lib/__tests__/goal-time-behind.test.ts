import { goalTimeBehindSeconds, formatTimeBehind } from '../goal-utils';

const today = new Date(2026, 9, 6, 12);
const goal = {
  startValue: 0, targetValue: 100, currentValue: 30, intervals: 10,
  intervalSeconds: 1800, startDate: '2026-10-01', dueDate: '2026-10-11',
};

test('converts a twenty-unit backlog into two thirty-minute tasks', () => {
  expect(goalTimeBehindSeconds(goal, today)).toBe(3600);
});

test('prorates partial intervals and respects a nonzero starting value', () => {
  expect(goalTimeBehindSeconds({ ...goal, startValue: 100, targetValue: 200, currentValue: 135 }, today)).toBe(2700);
});

test('on-pace tolerance, ahead and completed goals contribute zero', () => {
  for (const currentValue of [45, 50, 80, 100, 110]) {
    expect(goalTimeBehindSeconds({ ...goal, currentValue }, today)).toBe(0);
  }
});

test('before the start has no backlog and overdue estimates stop at the target', () => {
  expect(goalTimeBehindSeconds(goal, new Date(2026, 8, 30))).toBe(0);
  expect(goalTimeBehindSeconds(goal, new Date(2026, 9, 20))).toBe(12600);
});

test('same-day goals use the remaining work', () => {
  expect(goalTimeBehindSeconds({ ...goal, startDate: '2026-10-06', dueDate: '2026-10-06' }, today)).toBe(12600);
});

test('mixed goals add effort without an ahead goal canceling another backlog', () => {
  const goals = [goal, { ...goal, intervalSeconds: 900 }, { ...goal, currentValue: 90 }];
  const total = goals.reduce((sum, item) => sum + goalTimeBehindSeconds(item, today), 0);
  expect(total).toBe(5400);
  expect(formatTimeBehind(total)).toBe('1h 30m');
});

test('invalid interval settings do not produce infinite or negative estimates', () => {
  for (const patch of [{ intervals: 0 }, { targetValue: 0 }, { intervalSeconds: -1 }, { intervalSeconds: NaN }]) {
    expect(goalTimeBehindSeconds({ ...goal, ...patch }, today)).toBe(0);
  }
});

test('formats zero, partial minutes and more than a day of catch-up work', () => {
  expect(formatTimeBehind(0)).toBe('0m');
  expect(formatTimeBehind(1)).toBe('1m');
  expect(formatTimeBehind(3599)).toBe('1h');
  expect(formatTimeBehind(90060)).toBe('25h 1m');
});
