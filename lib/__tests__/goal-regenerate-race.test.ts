/**
 * Regression tests for regenerating a goal's cursor task twice at once.
 *
 * The route read the goal outside its transaction, so two requests at once
 * (a double-click on Regenerate) both saw no cursor and both made one: the
 * Task Bank got a duplicate, or, when both reused the old cursor's id, the
 * second request failed. The read is now inside a Serializable transaction,
 * and the request that loses the race re-runs and returns the other's cursor.
 */

import { POST } from '@/app/api/goals/[id]/regenerate/route';

type Row = Record<string, any>;

let goals: Row[] = [];
let bankTasks: Row[] = [];
// Bumped each time a transaction that changed the goal commits.
let goalVersions: Record<string, number> = {};
let generatedIds = 0;

const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
const step = () => Promise.resolve();

// Just enough of Postgres for this route: each transaction works on its own
// snapshot and commits at the end. At Serializable, one that read the goal
// before another transaction changed it is rolled back with Prisma's P2034,
// as Postgres does; otherwise both commit, and inserting an id that's
// already taken fails with P2002.
async function transaction(run: (tx: unknown) => Promise<unknown>, options?: { isolationLevel?: string }) {
  const snapshot = { goals: goals.map((g) => ({ ...g })), bankTasks: bankTasks.map((t) => ({ ...t })) };
  const goalsReadAt: Record<string, number> = {};
  const inserted: Row[] = [];
  const goalUpdates: { id: string; data: Row }[] = [];

  const result = await run({
    goal: {
      findFirst: async ({ where }: any) => {
        await step();
        const goal = snapshot.goals.find((g) => matches(g, where));
        if (goal) goalsReadAt[goal.id] = goalVersions[goal.id] ?? 0;
        return goal ? { ...goal } : null;
      },
      update: async ({ where, data }: any) => {
        await step();
        const goal = snapshot.goals.find((g) => g.id === where.id)!;
        Object.assign(goal, data);
        goalUpdates.push({ id: where.id, data });
        return { ...goal };
      },
    },
    bankTask: {
      findUnique: async ({ where }: any) => {
        await step();
        return snapshot.bankTasks.find((task) => task.id === where.id) ?? null;
      },
      create: async ({ data }: any) => {
        await step();
        const task = { ...data, id: data.id ?? `generated-${++generatedIds}` };
        snapshot.bankTasks.push(task);
        inserted.push(task);
        return { ...task };
      },
    },
  });
  await step();

  const readStale = Object.entries(goalsReadAt).some(([id, version]) => (goalVersions[id] ?? 0) !== version);
  if (options?.isolationLevel === 'Serializable' && readStale) {
    throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: 'P2034' });
  }
  if (inserted.some((task) => bankTasks.some((existing) => existing.id === task.id))) {
    throw Object.assign(new Error('Unique constraint failed on the fields: (`id`)'), { code: 'P2002' });
  }
  bankTasks.push(...inserted);
  for (const { id, data } of goalUpdates) {
    Object.assign(goals.find((g) => g.id === id)!, data);
    goalVersions[id] = (goalVersions[id] ?? 0) + 1;
  }
  return result;
}

jest.mock('@/lib/db', () => ({
  prisma: {
    $transaction: (run: any, options: any) => transaction(run, options),
    goal: { findFirst: async ({ where }: any) => goals.find((g) => matches(g, where)) ?? null },
  },
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(async () => ({ user: { id: 'user-1' } })),
}));

// A 0 → 100 page goal at 40, whose cursor task was deleted from the bank.
function seedOrphanedGoal(lastBankTaskId: string | null) {
  bankTasks = [];
  goalVersions = {};
  generatedIds = 0;
  goals = [{
    id: 'goal-1',
    userId: 'user-1',
    name: 'Read',
    unit: 'pages',
    startValue: 0,
    targetValue: 100,
    currentValue: 40,
    intervals: 10,
    intervalSeconds: 1500,
    color: 'orange',
    tags: [],
    dueDate: '2026-10-31',
    completedAt: null,
    bankTaskId: null,
    lastBankTaskId,
  }];
}

async function regenerate() {
  const req = new Request('http://localhost/api/goals/goal-1/regenerate', { method: 'POST' });
  const res = await POST(req as any, { params: { id: 'goal-1' } });
  return { status: res.status, body: await res.json() };
}

describe('regenerating a goal’s cursor task', () => {
  test.each([
    ['a goal with no earlier cursor id', null],
    ['a goal whose old cursor id is reused', 'cursor-old'],
  ])('two requests at once make one task, and both get it back (%s)', async (_label, lastBankTaskId) => {
    seedOrphanedGoal(lastBankTaskId);

    const [first, second] = await Promise.all([regenerate(), regenerate()]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(bankTasks).toHaveLength(1);
    expect(first.body.bankTaskId).toBe(bankTasks[0].id);
    expect(second.body.bankTaskId).toBe(bankTasks[0].id);
    expect(goals[0].bankTaskId).toBe(bankTasks[0].id);
  });

  test('a single request makes the task, named for the next chunk', async () => {
    seedOrphanedGoal('cursor-old');

    const { status, body } = await regenerate();

    expect(status).toBe(200);
    expect(bankTasks).toEqual([expect.objectContaining({ id: 'cursor-old', name: 'Read: 40–50 pages' })]);
    expect(body.bankTaskId).toBe('cursor-old');
  });
});
