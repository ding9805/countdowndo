import { PUT } from '@/app/api/goals/[id]/route';
import { goalTimeBehindSeconds } from '@/lib/goal-utils';

let saved: any;
const update = jest.fn(async ({ data }: any) => (saved = { ...saved, ...data }));
const findFirst = jest.fn(async () => saved);
jest.mock('@/lib/db', () => ({ prisma: {
  goal: { findFirst: (...args: any[]) => (findFirst as any)(...args) },
  $transaction: (run: any) => run({ goal: { findFirst, update } }),
} }));
jest.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'user-1' } }) }));
jest.mock('@/lib/goal-service', () => ({
  withSerializableRetry: (run: any) => run(), SERIALIZABLE: {},
  syncCursorTask: async (_tx: any, goal: any) => goal,
}));

beforeEach(() => {
  jest.clearAllMocks();
  saved = { id: 'goal-1', userId: 'user-1', name: 'Read', unit: 'pages',
    startValue: 0, currentValue: 20, targetValue: 100, intervals: 10,
    intervalSeconds: 1800, startDate: '2026-10-06', dueDate: '2026-10-11',
    completedAt: null, bankTaskId: 'bank-1', color: 'orange', tags: [] };
});
const put = (data: object) => PUT(new Request('http://localhost/api/goals/goal-1', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
}) as any, { params: { id: 'goal-1' } });

test('backdating an existing goal preserves progress and updates catch-up time', async () => {
  const response = await put({ startDate: '2026-10-01' });
  expect(response.status).toBe(200);
  expect(saved.startDate).toBe('2026-10-01');
  expect(saved.currentValue).toBe(20);
  expect(goalTimeBehindSeconds(saved, new Date(2026, 9, 6))).toBe(5400);
});

test.each([{ startDate: '2026-10-12' }, { dueDate: '2026-10-05' }, { startDate: '2026-02-30' }])('rejects invalid date changes %j', async (data) => {
  expect((await put(data)).status).toBe(400);
  expect(update).not.toHaveBeenCalled();
});

test('allows changing both dates together and same-day goals', async () => {
  expect((await put({ startDate: '2026-10-20', dueDate: '2026-10-20' })).status).toBe(200);
  expect(saved.startDate).toBe('2026-10-20');
});

test('progress-only edits retain the saved start date, even for legacy reversed dates', async () => {
  saved.dueDate = '2026-10-01';
  expect((await put({ currentValue: 30 })).status).toBe(200);
  expect(saved.startDate).toBe('2026-10-06');
});
