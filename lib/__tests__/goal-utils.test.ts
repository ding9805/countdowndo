import {
  cursorTaskName,
  cursorTaskNameOffset,
  intervalSize,
  remainingIntervals,
  snapGoalValue,
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

describe('snapGoalValue', () => {
  test('leaves a value already on the interval grid alone', () => {
    const goal = makeGoal({ startValue: 70, targetValue: 210, intervals: 20 });
    expect(snapGoalValue(105, goal)).toBe(105);
  });

  test('pulls an off-grid value onto the nearest boundary', () => {
    // The reported case: 70→210 in 20 chunks of 7, progress stuck at 105.1
    // after an edit that redrew the grid.
    const goal = makeGoal({ startValue: 70, targetValue: 210, intervals: 20 });
    expect(snapGoalValue(105.1, goal)).toBe(105);
    expect(snapGoalValue(103, goal)).toBe(105);
    expect(snapGoalValue(101, goal)).toBe(98);
  });

  test('clamps to the goal range', () => {
    const goal = makeGoal({ startValue: 70, targetValue: 210, intervals: 20 });
    expect(snapGoalValue(500, goal)).toBe(210);
    expect(snapGoalValue(0, goal)).toBe(70);
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
