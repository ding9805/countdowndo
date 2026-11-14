import { PUT } from '@/app/api/task-bank/[id]/route';

// A goal's cursor task is reused for every interval, so it must never become
// a one-off: completing it would hide it and Stop would delete it.

const findFirst = jest.fn();
const update = jest.fn();

jest.mock('@/lib/db', () => ({
  prisma: {
    bankTask: {
      findFirst: (...args: any[]) => findFirst(...args),
      update: (...args: any[]) => update(...args),
    },
  },
}));

jest.mock('@/lib/tag-utils', () => ({
  getUserTagCorpus: jest.fn(async () => []),
  normalizeTags: (_corpus: string[], tags: string[]) => tags,
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(async () => ({ user: { id: 'user-1' } })),
}));

function put(body: unknown) {
  const req = new Request('http://localhost/api/task-bank/task-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PUT(req as any, { params: { id: 'task-1' } });
}

const row = { id: 'task-1', userId: 'user-1', name: 'Read: 10–20 pages', isOneOff: false };

beforeEach(() => {
  findFirst.mockReset();
  update.mockReset();
  update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
});

test("refuses to make a goal's task one-off", async () => {
  findFirst.mockResolvedValue({ ...row, goal: { id: 'goal-1' } });

  const res = await put({ name: 'Read: 10–20 pages', isOneOff: true });

  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/goal's task can't be one-off/);
  expect(update).not.toHaveBeenCalled();
});

test("still saves other edits to a goal's task", async () => {
  findFirst.mockResolvedValue({ ...row, goal: { id: 'goal-1' } });

  const res = await put({ name: 'Read: 10–20 pages', durationSeconds: 900, isOneOff: false });

  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith({
    where: { id: 'task-1' },
    data: { name: 'Read: 10–20 pages', durationSeconds: 900, isOneOff: false },
  });
});

test('lets an ordinary task become one-off', async () => {
  findFirst.mockResolvedValue({ ...row, goal: null });

  const res = await put({ isOneOff: true });

  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { isOneOff: true } });
});
