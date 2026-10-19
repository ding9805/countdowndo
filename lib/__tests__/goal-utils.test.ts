import {
  cursorTaskName,
  cursorTaskNameOffset,
  intervalSize,
  remainingIntervals,
  nextIntervalBoundary,
  previousIntervalBoundary,
  isOffGrid,
  wholeIntervalSuggestions,
  goalLeadDays,
  overallLeadDays,
  addDays,
  daysBetween,
  paceStatus,
} from '../goal-utils';
import { GoalLike } from '../goal-utils';

function makeGoal(overrides: Partial<GoalLike>): GoalLike {
  return {
    name: 'Backtest strategy A',
    unit: 'trades',
    startValue: 0,
    targetValue: 100,
    currentValue: 10,
    intervals: 10,
    ...overrides,
  };
}

describe('cursorTaskNameOffset', () => {
  test('offset 0 is the current cursor chunk', () => {
    const goal = makeGoal({});
    expect(cursorTaskNameOffset(goal, 0)).toBe('Backtest strategy A: 10–20 trades');
    expect(cursorTaskName(goal)).toBe(cursorTaskNameOffset(goal, 0));
  });

  test('each offset labels the next interval chunk', () => {
    const goal = makeGoal({});
    expect(cursorTaskNameOffset(goal, 1)).toBe('Backtest strategy A: 20–30 trades');
    expect(cursorTaskNameOffset(goal, 2)).toBe('Backtest strategy A: 30–40 trades');
    expect(cursorTaskNameOffset(goal, 8)).toBe('Backtest strategy A: 90–100 trades');
  });

  test('clamps the final chunk at the target value', () => {
    const goal = makeGoal({ targetValue: 85, intervals: 8, currentValue: 74.375 });
    expect(cursorTaskNameOffset(goal, 0)).toBe('Backtest strategy A: 74.4–85 trades');
  });

  test('formats fractional interval sizes with one decimal', () => {
    const goal = makeGoal({ targetValue: 100, intervals: 7, currentValue: 0 });
    const size = intervalSize(goal); // 100 / 7
    expect(cursorTaskNameOffset(goal, 0)).toBe(`Backtest strategy A: 0–${Math.round(size * 10) / 10} trades`);
  });
});

describe('remainingIntervals', () => {
  test('full goal from the start has every interval left', () => {
    expect(remainingIntervals(makeGoal({ currentValue: 0 }))).toBe(10);
  });

  test('shrinks one per completed chunk', () => {
    expect(remainingIntervals(makeGoal({ currentValue: 10 }))).toBe(9);
    expect(remainingIntervals(makeGoal({ currentValue: 90 }))).toBe(1);
  });

  test('zero for a complete goal', () => {
    expect(remainingIntervals(makeGoal({ currentValue: 100 }))).toBe(0);
  });

  test('a partial final chunk still counts as one interval', () => {
    expect(remainingIntervals(makeGoal({ targetValue: 85, intervals: 8, currentValue: 74.375 }))).toBe(1);
  });
});

describe('interval grid correction', () => {
  // The reported case: 70→210 in 20 chunks of 7, progress left at 105.1 by an
  // edit that redrew the grid under it.
  const drifted = makeGoal({ startValue: 70, targetValue: 210, intervals: 20, currentValue: 105.1 });

  test('next boundary is the catch-up point, not current + one interval', () => {
    expect(nextIntervalBoundary(drifted, drifted.currentValue)).toBe(112);
  });

  test('a goal already on the grid steps a full interval', () => {
    const onGrid = { ...drifted, currentValue: 105 };
    expect(nextIntervalBoundary(onGrid, onGrid.currentValue)).toBe(112);
    expect(previousIntervalBoundary(onGrid, onGrid.currentValue)).toBe(98);
  });

  test('retreat from a corrective chunk lands back on the grid', () => {
    expect(previousIntervalBoundary(drifted, 112)).toBe(105);
  });

  test('boundaries clamp to the goal range', () => {
    expect(nextIntervalBoundary(drifted, 209)).toBe(210);
    expect(previousIntervalBoundary(drifted, 70)).toBe(70);
  });

  test('the cursor task is the catch-up chunk, then whole intervals', () => {
    expect(cursorTaskNameOffset(drifted, 0)).toBe('Backtest strategy A: 105.1–112 trades');
    expect(cursorTaskNameOffset(drifted, 1)).toBe('Backtest strategy A: 112–119 trades');
    expect(cursorTaskNameOffset(drifted, 2)).toBe('Backtest strategy A: 119–126 trades');
  });

  test('isOffGrid flags only drifted, incomplete goals', () => {
    expect(isOffGrid(drifted)).toBe(true);
    expect(isOffGrid({ ...drifted, currentValue: 105 })).toBe(false);
    expect(isOffGrid({ ...drifted, currentValue: 210 })).toBe(false);
  });

  test('remaining count stays whole across the correction', () => {
    expect(remainingIntervals(drifted)).toBe(15);
    expect(remainingIntervals({ ...drifted, currentValue: 112 })).toBe(14);
  });
});

describe('wholeIntervalSuggestions', () => {
  test('offers nearby counts that divide the range evenly', () => {
    expect(wholeIntervalSuggestions(70, 210, 23)).toEqual([14, 20, 28]);
  });

  test('silent when the count already gives whole chunks', () => {
    expect(wholeIntervalSuggestions(70, 210, 20)).toEqual([]);
  });

  test('silent for a fractional range', () => {
    expect(wholeIntervalSuggestions(0, 10.5, 4)).toEqual([]);
  });

  // The form used to try every number up to the range, on every keystroke.
  test('only suggests counts a goal can have', () => {
    // 1009 is prime, and its other divisor, itself, is over the limit.
    expect(wholeIntervalSuggestions(0, 1009, 10)).toEqual([1]);
  });

  test('stays quick for a range in the billions', () => {
    const started = Date.now();
    expect(wholeIntervalSuggestions(0, 2e9, 7)).toEqual([4, 5, 8]);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('goalLeadDays', () => {
  // 0→100 over 40 days (2.5 a day), chunks of 10, so "on pace" allows ±5.
  // On 2026-10-11, day 10, the schedule expects 25.
  const scheduled = (currentValue: number) => ({
    ...makeGoal({ currentValue }),
    startDate: '2026-10-01',
    dueDate: '2026-11-10',
  });
  const today = new Date(2026, 9, 11);

  test('counts the days of schedule progress already covers', () => {
    // 51 + 5 tolerance covers the schedule up to day 22, 12 days from today.
    expect(goalLeadDays(scheduled(51), today)).toBe(12);
  });

  test('the lead is the last day still on track', () => {
    const goal = scheduled(51);
    expect(paceStatus(goal, addDays(today, 12)).status).not.toBe('behind');
    expect(paceStatus(goal, addDays(today, 13)).status).toBe('behind');
  });

  test('exactly on pace still has the tolerance as lead', () => {
    expect(goalLeadDays(scheduled(25), today)).toBe(2);
  });

  test('negative when behind: the days to make up', () => {
    expect(goalLeadDays(scheduled(10), today)).toBe(-4);
    expect(paceStatus(scheduled(10), addDays(today, -4)).status).not.toBe('behind');
  });

  test('Infinity when progress already covers the due date', () => {
    expect(goalLeadDays(scheduled(96), today)).toBe(Infinity);
    expect(goalLeadDays(scheduled(100), today)).toBe(Infinity);
  });

  test('counts from before the start date', () => {
    // Nothing done, 6 days before the start: on track until day 2 (Oct 3).
    expect(goalLeadDays(scheduled(0), new Date(2026, 8, 25))).toBe(8);
  });

  test('an overdue goal leads by the days since it fell behind', () => {
    expect(goalLeadDays(scheduled(51), new Date(2026, 10, 20))).toBe(-28);
  });
});

describe('overallLeadDays', () => {
  const today = new Date(2026, 9, 11);
  const dated = { startDate: '2026-10-01', dueDate: '2026-11-10' };

  test('takes the goal furthest behind', () => {
    const a = { ...makeGoal({ name: 'A', currentValue: 51 }), ...dated };
    const b = { ...makeGoal({ name: 'B', currentValue: 10 }), ...dated };
    expect(overallLeadDays([a, b], today)).toEqual({ days: -4, goal: b });
  });

  test('skips complete goals, null when none are left', () => {
    const done = { ...makeGoal({ currentValue: 100 }), ...dated };
    expect(overallLeadDays([done], today)).toBeNull();
    expect(overallLeadDays([], today)).toBeNull();
  });
});

describe('addDays / daysBetween', () => {
  test('step whole calendar days across month ends', () => {
    expect(addDays(new Date(2026, 9, 30), 3)).toEqual(new Date(2026, 10, 2));
    expect(daysBetween(new Date(2026, 9, 30), new Date(2026, 10, 2))).toBe(3);
    expect(daysBetween(new Date(2026, 10, 2, 23, 59), new Date(2026, 9, 30))).toBe(-3);
  });
});
