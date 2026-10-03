/**
 * Regression tests for the day a new goal starts on.
 *
 * The start date was the server's date, which is UTC on Vercel: a goal
 * created between midnight and 8 AM in Singapore started "yesterday", so its
 * pace badge said Behind straight away. The browser now sends its own date.
 */

import { POST } from '@/app/api/goals/route';
import { goalStartDate } from '@/lib/goal-utils';

let createdGoals: Record<string, any>[] = [];

jest.mock('@/lib/db', () => ({
  prisma: {
    $transaction: (run: (client: unknown) => unknown) => run({
      goal: {
        create: async ({ data }: any) => {
          const goal = { ...data, id: `goal-${createdGoals.length + 1}` };
          createdGoals.push(goal);
          return goal;
        },
      },
    }),
  },
}));
jest.mock('@/lib/goal-service', () => ({ createCursorTask: async (_tx: unknown, goal: unknown) => goal }));
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(async () => ({ user: { id: 'user-1' } })),
}));

// 7:30 AM on 3 October in Singapore.
const SINGAPORE_MORNING = new Date('2026-10-02T23:30:00Z');

async function createGoal(extra: Record<string, unknown>) {
  const req = new Request('http://localhost/api/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Read',
      unit: 'pages',
      startValue: 0,
      targetValue: 100,
      intervals: 10,
      intervalSeconds: 1500,
      dueDate: '2026-10-31',
      ...extra,
    }),
  });
  const res = await POST(req as any);
  expect(res.status).toBe(200);
  return createdGoals[createdGoals.length - 1];
}

beforeEach(() => {
  createdGoals = [];
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  jest.setSystemTime(SINGAPORE_MORNING);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a new goal’s start date', () => {
  test('is the date the browser sends, not the server’s UTC date', async () => {
    const goal = await createGoal({ startDate: '2026-10-03' });

    expect(goal.startDate).toBe('2026-10-03');
  });

  test('falls back to the server’s date when the browser sends none', async () => {
    const goal = await createGoal({});

    expect(goal.startDate).toBe('2026-10-02');
  });

  test('accepts a date up to a day either side of the server’s, as every timezone’s is, but not further', () => {
    expect(goalStartDate('2026-10-01', SINGAPORE_MORNING)).toBe('2026-10-01');
    expect(goalStartDate('2026-10-03', SINGAPORE_MORNING)).toBe('2026-10-03');
    expect(goalStartDate('2026-09-30', SINGAPORE_MORNING)).toBe('2026-10-02');
    expect(goalStartDate('2026-10-04', SINGAPORE_MORNING)).toBe('2026-10-02');
  });
});
