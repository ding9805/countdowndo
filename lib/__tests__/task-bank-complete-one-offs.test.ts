import { POST } from '@/app/api/task-bank/complete-one-offs/route';

const deleteMany = jest.fn();
const updateMany = jest.fn();

jest.mock('@/lib/db', () => {
  return {
    prisma: {
      bankTask: {
        deleteMany: (...args: any[]) => deleteMany(...args),
        updateMany: (...args: any[]) => updateMany(...args),
      },
    },
  };
});

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

import { getServerSession } from 'next-auth';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/task-bank/complete-one-offs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/task-bank/complete-one-offs', () => {
  beforeEach(() => {
    deleteMany.mockReset();
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 0 });
  });

  test('returns 401 when not authenticated', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq({ bankTaskIds: ['a'] }) as any);
    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('deletes only one-off bank tasks belonging to the current user', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
    deleteMany.mockResolvedValue({ count: 2 });

    const res = await POST(makeReq({ bankTaskIds: ['a', 'b', 'c'] }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ count: 2, restored: 0 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['a', 'b', 'c'] },
        userId: 'user-1',
        isOneOff: true,
      },
    });
  });

  test('restores stray soft-deleted rows after the delete', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
    deleteMany.mockResolvedValue({ count: 1 });
    updateMany.mockResolvedValue({ count: 2 });

    const res = await POST(makeReq({ bankTaskIds: ['a'] }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ count: 1, restored: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', completedAt: { not: null } },
      data: { completedAt: null },
    });
  });

  test('empty batch skips the delete but still restores', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
    updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeReq({ bankTaskIds: [] }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ count: 0, restored: 1 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });

  test('returns 400 for missing body fields', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });

    const res = await POST(makeReq({}) as any);
    expect(res.status).toBe(400);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
