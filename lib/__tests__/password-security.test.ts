import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { POST as signup } from '@/app/api/signup/route';
import { hashResetToken } from '@/lib/reset-token';

const TOKEN = 'local-test-reset-token';
type User = {
  id: string;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
  hashedPassword: string;
  tokenVersion: number;
};
let user: User;
let writes: string[];
let created: Record<string, unknown>[];
let duringHash: () => void;

function matches(where: any): boolean {
  return (!where.id || where.id === user.id)
    && (!where.resetToken || where.resetToken === user.resetToken)
    && (!where.resetTokenExpiry || (user.resetTokenExpiry !== null && user.resetTokenExpiry > where.resetTokenExpiry.gt));
}

function updateUser(data: any) {
  user = { ...user, ...data, tokenVersion: user.tokenVersion + data.tokenVersion.increment };
  writes.push(data.hashedPassword);
  return { ...user };
}

jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findFirst: async ({ where }: any) => matches(where) ? { ...user } : null,
      update: async ({ data }: any) => updateUser(data),
      // Model one atomic database statement: evaluate its predicate against
      // current state and write before the next request can run its update.
      updateMany: async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        updateUser(data);
        return { count: 1 };
      },
      findUnique: async () => null,
      create: async ({ data }: any) => {
        created.push(data);
        return { id: 'new-user', ...data };
      },
    },
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '203.0.113.7',
  checkAndRecordRateLimit: async () => ({ limited: false, waitSeconds: 0 }),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (password: string) => {
    duringHash();
    return `hashed:${password}`;
  }),
}));

function reset(password = 'new-password', token = TOKEN) {
  return resetPassword(new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  }));
}

beforeEach(() => {
  user = {
    id: 'test-user',
    resetToken: hashResetToken(TOKEN),
    resetTokenExpiry: new Date(Date.now() + 60_000),
    hashedPassword: 'original-hash',
    tokenVersion: 3,
  };
  writes = [];
  created = [];
  duringHash = () => {};
  jest.clearAllMocks();
});

test('concurrent resets consume the token once and invalidate sessions once', async () => {
  const passwords = ['first-password', 'second-password'];
  const responses = await Promise.all(passwords.map((password) => reset(password)));
  expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  const winner = responses.findIndex((response) => response.status === 200);
  expect(user.hashedPassword).toBe(`hashed:${passwords[winner]}`);
  expect(writes).toHaveLength(1);
  expect(user.tokenVersion).toBe(4);
  expect(user.resetToken).toBeNull();
  expect(user.resetTokenExpiry).toBeNull();
  expect((await reset()).status).toBe(400);
  expect(writes).toHaveLength(1);
});

test.each(['expired', 'replaced'] as const)('a token %s during hashing cannot change the password', async (change) => {
  duringHash = () => {
    if (change === 'expired') user.resetTokenExpiry = new Date(Date.now() - 1);
    else user.resetToken = hashResetToken('replacement-token');
  };
  const response = await reset();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Invalid or expired reset link. Please request a new one.' });
  expect(user.hashedPassword).toBe('original-hash');
  expect(user.tokenVersion).toBe(3);
  expect(writes).toHaveLength(0);
});

test('an invalid token is rejected before hashing', async () => {
  expect((await reset('new-password', 'wrong-token')).status).toBe(400);
  expect(bcrypt.hash).not.toHaveBeenCalled();
});

describe.each([
  ['ASCII', 'a'.repeat(72)],
  ['accented characters', 'é'.repeat(36)],
  ['CJK characters', '界'.repeat(24)],
  ['emoji', '😀'.repeat(18)],
])('%s passwords', (_label, boundary) => {
  test.each(['signup', 'reset'])('%s accepts exactly 72 UTF-8 bytes', async (endpoint) => {
    expect(Buffer.byteLength(boundary, 'utf8')).toBe(72);
    const response = endpoint === 'reset'
      ? await reset(boundary)
      : await signup(new NextRequest('http://localhost/api/signup', {
        method: 'POST', body: JSON.stringify({ email: 'test@example.com', password: boundary }),
      }));
    expect(response.status).toBe(200);
    expect(bcrypt.hash).toHaveBeenCalledWith(boundary, 12);
  });

  test.each(['signup', 'reset'])('%s rejects 73 UTF-8 bytes before hashing or writing', async (endpoint) => {
    const password = `${boundary}a`;
    expect(Buffer.byteLength(password, 'utf8')).toBe(73);
    const response = endpoint === 'reset'
      ? await reset(password)
      : await signup(new NextRequest('http://localhost/api/signup', {
        method: 'POST', body: JSON.stringify({ email: 'test@example.com', password }),
      }));
    expect(response.status).toBe(400);
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(user.resetToken).toBe(hashResetToken(TOKEN));
  });
});
