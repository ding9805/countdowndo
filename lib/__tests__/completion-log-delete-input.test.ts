import { DELETE } from '@/app/api/completion-log/route';

// A malformed retraction is the client's mistake: answer 400 rather than
// letting a non-string id reach Prisma and fail as a 500.

const findFirst = jest.fn();
const remove = jest.fn();

jest.mock('@/lib/db', () => ({
  prisma: {
    completionLog: {
      findFirst: (...args: any[]) => findFirst(...args),
      delete: (...args: any[]) => remove(...args),
    },
  },
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(async () => ({ user: { id: 'user-1' } })),
}));

function del(body: string) {
  const req = new Request('http://localhost/api/completion-log', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return DELETE(req as any);
}

beforeEach(() => {
  findFirst.mockReset();
  remove.mockReset();
});

test.each([
  ['an object id', JSON.stringify({ id: { not: 'x' } })],
  ['a numeric id', JSON.stringify({ id: 42 })],
  ['no id', JSON.stringify({})],
  ['a body that is not JSON', 'not json'],
])('%s is a bad request', async (_label, body) => {
  const res = await del(body);

  expect(res.status).toBe(400);
  expect(findFirst).not.toHaveBeenCalled();
});

test('a string id is looked up for the current user and deleted', async () => {
  findFirst.mockResolvedValue({ id: 'log-1' });

  const res = await del(JSON.stringify({ id: 'log-1' }));

  expect(res.status).toBe(200);
  expect(findFirst).toHaveBeenCalledWith({ where: { id: 'log-1', userId: 'user-1' } });
  expect(remove).toHaveBeenCalledWith({ where: { id: 'log-1' } });
});
