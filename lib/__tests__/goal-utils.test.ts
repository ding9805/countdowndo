import {
  cursorTaskName,
  cursorTaskNameOffset,
  intervalSize,
  remainingIntervals,
  nextIntervalBoundary,
  previousIntervalBoundary,
  isOffGrid,
  wholeIntervalSuggestions,
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
});
