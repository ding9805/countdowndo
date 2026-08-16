// Pure helpers for the Goals feature — interval math, cursor-task labels, and
// pace calculation. Shared by the API routes (server) and the Goals UI
// (client), so nothing here may touch Prisma or browser APIs.

export const GOAL_EPSILON = 1e-9;

export interface GoalLike {
  name: string;
  unit: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  intervals: number;
}

export function intervalSize(goal: Pick<GoalLike, 'startValue' | 'targetValue' | 'intervals'>): number {
  return (goal.targetValue - goal.startValue) / goal.intervals;
}

// Formats a value with at most 1 decimal, dropping a trailing ".0".
export function formatGoalValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// The task name for the chunk `offset` intervals ahead of the goal's current
// cursor — offset 0 is the live cursor task, offset 1 the next interval, etc.
// Used to label repeated adds of a goal's cursor task into a session so each
// copy is the next chunk (10→20, then 20→30, …) instead of a duplicate name.
export function cursorTaskNameOffset(goal: GoalLike, offset: number): string {
  const size = intervalSize(goal);
  const from = goal.currentValue + offset * size;
  const to = Math.min(from + size, goal.targetValue);
  return `${goal.name}: ${formatGoalValue(from)}–${formatGoalValue(to)} ${goal.unit}`;
}

export function cursorTaskName(goal: GoalLike): string {
  return cursorTaskNameOffset(goal, 0);
}

// How many more interval tasks (including a partial final chunk) a goal can
// produce from its current cursor before reaching the target.
export function remainingIntervals(
  goal: Pick<GoalLike, 'startValue' | 'targetValue' | 'currentValue' | 'intervals'>
): number {
  if (isGoalComplete(goal)) return 0;
  return Math.max(0, Math.ceil((goal.targetValue - goal.currentValue) / intervalSize(goal) - GOAL_EPSILON));
}

export function isGoalComplete(goal: Pick<GoalLike, 'currentValue' | 'targetValue'>): boolean {
  return goal.currentValue >= goal.targetValue - GOAL_EPSILON;
}

export function clampGoalValue(value: number, goal: Pick<GoalLike, 'startValue' | 'targetValue'>): number {
  return Math.min(Math.max(value, goal.startValue), goal.targetValue);
}

// Fraction of the goal done, in [0, 1].
export function goalProgress(goal: Pick<GoalLike, 'startValue' | 'targetValue' | 'currentValue'>): number {
  const range = goal.targetValue - goal.startValue;
  if (range <= 0) return 1;
  return Math.min(Math.max((goal.currentValue - goal.startValue) / range, 0), 1);
}

// Where currentValue "should" be today for an even pace from startDate to
// dueDate. Dates are "YYYY-MM-DD" local calendar dates, same as BankTask.
export function expectedValueToday(
  goal: Pick<GoalLike, 'startValue' | 'targetValue'> & { startDate: string; dueDate: string },
  today: Date = new Date()
): number {
  const start = parseLocalDate(goal.startDate).getTime();
  const due = parseLocalDate(goal.dueDate).getTime();
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (due <= start) return goal.targetValue;
  const t = Math.min(Math.max((now - start) / (due - start), 0), 1);
  return goal.startValue + (goal.targetValue - goal.startValue) * t;
}

export type PaceStatus = { status: 'ahead' | 'on-pace' | 'behind'; delta: number };

export function paceStatus(
  goal: Pick<GoalLike, 'startValue' | 'targetValue' | 'currentValue' | 'intervals'> & { startDate: string; dueDate: string },
  today: Date = new Date()
): PaceStatus {
  const expected = expectedValueToday(goal, today);
  const delta = goal.currentValue - expected;
  // "On pace" within half a chunk either way, so the badge isn't jittery.
  const tolerance = Math.abs(intervalSize(goal)) / 2;
  if (delta > tolerance) return { status: 'ahead', delta };
  if (delta < -tolerance) return { status: 'behind', delta };
  return { status: 'on-pace', delta };
}

export function todayLocalDateString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
