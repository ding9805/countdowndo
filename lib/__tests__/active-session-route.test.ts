/**
 * Regression tests for the optimistic-concurrency check on saving the active
 * session (POST /api/active-session).
 *
 * Every save is a full-state overwrite, so the server must only accept one
 * built on the version of the row it replaces: a client that has seen no row
 * may only create one, a client whose row was deleted (a Stop elsewhere) may
 * not bring it back, and two concurrent saves built on the same version can't
 * both win.
 */

import { POST } from '@/app/api/active-session/route';

type Row = Record<string, any>;

let rows: Row[] = [];
let clock = 0;

const nextTimestamp = () => new Date(Date.UTC(2026, 9, 3, 9) + ++clock);
// Each call yields first, like a round trip to the database, so concurrent
// requests interleave; the operation itself then runs atomically, as a single
// SQL statement does.
const roundTrip = () => new Promise((resolve) => setImmediate(resolve));
const copy = (row: Row | undefined) => (row ? { ...row } : null);

// Just enough of the Prisma client for the route, backed by `rows`.
const mockPrisma = {
  user: { findUnique: async () => ({ id: 'user-1' }) },
  activeSession: {
    findUnique: async ({ where }: any) => {
      await roundTrip();
      return copy(rows.find((row) => row.userId === where.userId));
    },
    create: async ({ data }: any) => {
      await roundTrip();
      if (rows.some((row) => row.userId === data.userId)) {
        throw Object.assign(new Error('Unique constraint failed on the fields: (`userId`)'), { code: 'P2002' });
      }
      const now = nextTimestamp();
      const row = { id: `session-${clock}`, ...data, createdAt: now, updatedAt: now };
      rows.push(row);
      return copy(row);
    },
    updateMany: async ({ where, data }: any) => {
      await roundTrip();
      const hits = rows.filter(
        (row) => row.userId === where.userId && row.updatedAt.getTime() === where.updatedAt.getTime()
      );
      hits.forEach((row) => Object.assign(row, data, { updatedAt: nextTimestamp() }));
      return { count: hits.length };
    },
  },
  $transaction: (run: (tx: unknown) => unknown) => run(mockPrisma),
};

jest.mock('@/lib/db', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(async () => ({ user: { id: 'user-1' } })),
}));

function sessionPayload(taskName: string, lastKnownUpdatedAt: string | null) {
  return {
    tasks: [{
      id: `task-${taskName}`,
      name: taskName,
      durationSeconds: 600,
      cumulativeSeconds: 600,
      isDone: false,
      doneAt: null,
      bonusSeconds: 0,
      color: 'orange',
    }],
    sessionState: 'running',
    sessionMode: 'continuous',
    sessionStartMs: Date.UTC(2026, 9, 3, 9),
    pausedElapsed: 0,
    sessionTotalSeconds: 600,
    soundPlayed: [],
    lastKnownUpdatedAt,
  };
}

async function save(taskName: string, lastKnownUpdatedAt: string | null) {
  const req = new Request('http://localhost/api/active-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionPayload(taskName, lastKnownUpdatedAt)),
  });
  const res = await POST(req as any);
  return { status: res.status, body: await res.json() };
}

const savedTaskNames = () => rows.map((row) => row.tasks[0].name);

beforeEach(() => {
  rows = [];
  clock = 0;
});

describe('POST /api/active-session', () => {
  test('a client that has seen no session creates one', async () => {
    const res = await save('Write report', null);

    expect(res.status).toBe(200);
    expect(savedTaskNames()).toEqual(['Write report']);
  });

  test('a client that has seen no session cannot overwrite one started elsewhere', async () => {
    await save('Started on phone', null);

    const res = await save('Staged on laptop', null);

    expect(res.status).toBe(409);
    expect(res.body.latest.tasks[0].name).toBe('Started on phone');
    expect(savedTaskNames()).toEqual(['Started on phone']);
  });

  test('a save built on the current version replaces it', async () => {
    const first = await save('Write report', null);

    const res = await save('Write report v2', first.body.updatedAt);

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).not.toBe(first.body.updatedAt);
    expect(savedTaskNames()).toEqual(['Write report v2']);
  });

  test('a save built on an older version is rejected with the latest one', async () => {
    const first = await save('Write report', null);
    await save('Renamed on phone', first.body.updatedAt);

    const res = await save('Renamed on laptop', first.body.updatedAt);

    expect(res.status).toBe(409);
    expect(res.body.latest.tasks[0].name).toBe('Renamed on phone');
    expect(savedTaskNames()).toEqual(['Renamed on phone']);
  });

  test('a save built on a version that was since deleted does not bring the session back', async () => {
    const first = await save('Write report', null);
    rows = []; // stopped on another device

    const res = await save('Write report', first.body.updatedAt);

    expect(res.status).toBe(409);
    expect(res.body.latest).toBeNull();
    expect(rows).toHaveLength(0);
  });

  test('of two concurrent saves built on the same version, only one is accepted', async () => {
    const first = await save('Write report', null);

    const results = await Promise.all([
      save('Edited on phone', first.body.updatedAt),
      save('Edited on laptop', first.body.updatedAt),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const accepted = results.find((res) => res.status === 200)!;
    expect(savedTaskNames()).toEqual([accepted.body.tasks[0].name]);
  });

  test('of two concurrent first saves, only one creates the session', async () => {
    const results = await Promise.all([save('Started on phone', null), save('Started on laptop', null)]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(rows).toHaveLength(1);
  });
});
