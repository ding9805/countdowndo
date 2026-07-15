import { POST } from '@/app/api/task-bank/check-one-offs/route';

const updateMany = jest.fn();

jest.mock('@/lib/db', () => {
  return {
    prisma: {
      bankTask: { updateMany: (...args: any[]) => updateMany(...args) },
    },
  };
});

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

import { getServerSession } from 'next-auth';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/task-bank/check-one-offs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/task-bank/check-one-offs', () => {
  beforeEach(() => {
    updateMany.mockReset();
  });

  test('returns 401 when not authenticated', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq({ bankTaskIds: ['a'], done: true }) as any);
    expect(res.status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('done=true soft-deletes only currently-one-off rows of the user', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
    updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeReq({ bankTaskIds: ['a', 'b'], done: true }) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });

    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ['a', 'b'] }, userId: 'user-1', isOneOff: true });
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  test('done=false restores rows regardless of the current isOneOff flag', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });
    updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeReq({ bankTaskIds: ['a'], done: false }) as any);
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] }, userId: 'user-1' },
      data: { completedAt: null },
    });
  });

  test('returns 400 for empty batch', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });

    const res = await POST(makeReq({ bankTaskIds: [], done: true }) as any);
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('returns 400 when done is missing', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } });

    const res = await POST(makeReq({ bankTaskIds: ['a'] }) as any);
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
