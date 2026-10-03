/**
 * Regression tests for goal cursor ids across an undo past completion.
 *
 * Completing a goal's final chunk deletes its cursor bank task; un-marking the
 * session task recreates it. That session task still holds the original
 * bankTaskId, so the recreated cursor has to keep that id — otherwise marking
 * the task done again matches no goal and the goal silently stays one chunk
 * short of its target.
 *
 * The route also reports whether a step moved the goal at all, so the session
 * engine only rolls back steps that happened: un-marking an extra copy that
 * was marked done after the goal was complete must not un-complete it.
 */

import { POST } from '@/app/api/goals/step/route';
import { createCursorTask } from '@/lib/goal-service';

type Row = Record<string, any>;

let goals: Row[] = [];
let bankTasks: Row[] = [];
let generatedIds = 0;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) =>
    key === 'OR' ? (value as Row[]).some((clause) => matches(row, clause)) : row[key] === value
  );
}

// Just enough of a Prisma transaction client for the goal step path, backed by
// the two in-memory tables above.
const mockTx = {
  goal: {
    findFirst: async ({ where }: any) => {
      const goal = goals.find((g) => matches(g, where));
      return goal ? { ...goal } : null;
    },
    update: async ({ where, data }: any) => {
      const goal = goals.find((g) => g.id === where.id)!;
      Object.assign(goal, data);
      return { ...goal };
    },
  },
  bankTask: {
    findUnique: async ({ where }: any) => bankTasks.find((task) => task.id === where.id) ?? null,
    create: async ({ data }: any) => {
      const task = { ...data, id: data.id ?? `generated-${++generatedIds}` };
      bankTasks.push(task);
      return { ...task };
    },
    updateMany: async ({ where, data }: any) => {
      const hits = bankTasks.filter((task) => matches(task, where));
      hits.forEach((task) => Object.assign(task, data));
      return { count: hits.length };
    },
    deleteMany: async ({ where }: any) => {
      const before = bankTasks.length;
      bankTasks = bankTasks.filter((task) => !matches(task, where));
      // Goal.bankTaskId is onDelete: SetNull.
      goals.forEach((goal) => {
        if (goal.bankTaskId && !bankTasks.some((task) => task.id === goal.bankTaskId)) goal.bankTaskId = null;
      });
      return { count: before - bankTasks.length };
    },
  },
};

jest.mock('@/lib/db', () => ({
  prisma: { $transaction: (run: (client: unknown) => unknown) => run(mockTx) },
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(async () => ({ user: { id: 'user-1' } })),
}));

// A 0 → 100 page goal in 10 chunks, sitting on its final chunk.
function seedGoalOnFinalChunk() {
  generatedIds = 0;
  bankTasks = [{ id: 'cursor-1', userId: 'user-1', name: 'Read: 90–100 pages' }];
  goals = [{
    id: 'goal-1',
    userId: 'user-1',
    name: 'Read',
    unit: 'pages',
    startValue: 0,
    targetValue: 100,
    currentValue: 90,
    intervals: 10,
    intervalSeconds: 600,
    color: 'orange',
    tags: [],
    startDate: '2026-10-01',
    dueDate: '2026-12-31',
    completedAt: null,
    bankTaskId: 'cursor-1',
    lastBankTaskId: 'cursor-1',
  }];
}

async function step(bankTaskId: string, direction: 'advance' | 'retreat') {
  const req = new Request('http://localhost/api/goals/step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bankTaskId, direction }),
  });
  const res = await POST(req as any);
  expect(res.status).toBe(200);
  return res.json();
}

describe('goal cursor id across an undo past completion', () => {
  beforeEach(seedGoalOnFinalChunk);

  test('marking the final chunk done again after an undo completes the goal', async () => {
    // The session task keeps bankTaskId 'cursor-1' through every step.
    await step('cursor-1', 'advance');
    expect(goals[0]).toMatchObject({ currentValue: 100, bankTaskId: null });
    expect(bankTasks).toHaveLength(0);

    await step('cursor-1', 'retreat');
    expect(goals[0]).toMatchObject({ currentValue: 90, bankTaskId: 'cursor-1', lastBankTaskId: 'cursor-1' });
    expect(bankTasks.map((task) => task.id)).toEqual(['cursor-1']);

    const redo = await step('cursor-1', 'advance');
    expect(redo.goal).not.toBeNull();
    expect(goals[0].currentValue).toBe(100);
    expect(goals[0].completedAt).toBeInstanceOf(Date);
  });

  test('createCursorTask reuses the previous cursor id once that row is gone', async () => {
    // Orphaned: the cursor was deleted straight from the bank (Regenerate path).
    bankTasks = [];
    goals[0].bankTaskId = null;

    const goal = await createCursorTask(mockTx as any, goals[0] as any);

    expect(goal.bankTaskId).toBe('cursor-1');
    expect(bankTasks.map((task) => task.id)).toEqual(['cursor-1']);
  });

  test('createCursorTask falls back to a fresh id while the previous id is still taken', async () => {
    goals[0].bankTaskId = null; // the 'cursor-1' row itself is still in the bank

    const goal = await createCursorTask(mockTx as any, goals[0] as any);

    expect(goal.bankTaskId).toBe('generated-1');
    expect(bankTasks.map((task) => task.id)).toEqual(['cursor-1', 'generated-1']);
  });
});

describe('whether a step moved the goal', () => {
  beforeEach(seedGoalOnFinalChunk);

  test('advancing a goal that is already complete reports that nothing moved', async () => {
    expect(await step('cursor-1', 'advance')).toMatchObject({ moved: true });
    expect(await step('cursor-1', 'advance')).toMatchObject({ moved: false });
    expect(goals[0].currentValue).toBe(100);
  });

  test('rolling a step back reports a move', async () => {
    await step('cursor-1', 'advance');

    expect(await step('cursor-1', 'retreat')).toMatchObject({ moved: true });
    expect(goals[0].currentValue).toBe(90);
  });

  test('a task that is not a goal cursor moves nothing', async () => {
    expect(await step('not-a-cursor', 'advance')).toEqual({ goal: null, moved: false });
  });
});
