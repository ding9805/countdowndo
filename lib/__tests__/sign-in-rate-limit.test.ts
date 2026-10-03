/**
 * Regression tests for rate-limiting sign-in attempts in the credentials
 * provider's `authorize`.
 *
 * Without a limit anyone could guess passwords endlessly, and every guess
 * costs the server a bcrypt hash. Failed attempts are capped per email and per
 * IP; a refused attempt never reaches the password check.
 */

import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { TOO_MANY_SIGN_IN_ATTEMPTS } from '@/lib/auth-errors';

type Row = Record<string, any>;

const PASSWORD = 'correct horse';
const WINDOW_MS = 15 * 60 * 1000;

const mockUsers = [{
  id: 'user-1',
  email: 'sam@example.com',
  name: 'Sam',
  hashedPassword: bcrypt.hashSync(PASSWORD, 4),
  tokenVersion: 0,
}];
let entries: Row[] = [];
let entryIds = 0;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[field]);
      if ('gte' in condition) return row[field] >= condition.gte;
      if ('lt' in condition) return row[field] < condition.lt;
    }
    return row[field] === condition;
  });
}

// Just enough of the Prisma client for sign-in, backed by `entries`.
const mockPrisma = {
  user: {
    findUnique: async ({ where }: any) => mockUsers.find((user) => user.email === where.email) ?? null,
  },
  rateLimitEntry: {
    create: async ({ data }: any) => {
      const row = { id: `entry-${++entryIds}`, ...data, createdAt: new Date() };
      entries.push(row);
      return { ...row };
    },
    count: async ({ where }: any) => entries.filter((row) => matches(row, where)).length,
    deleteMany: async ({ where }: any) => {
      const before = entries.length;
      entries = entries.filter((row) => !matches(row, where));
      return { count: before - entries.length };
    },
  },
};

jest.mock('@/lib/db', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

const authorize = (authOptions.providers[0] as any).options.authorize as (
  credentials: Record<string, string>,
  req: unknown
) => Promise<unknown>;

const signIn = (email: string, password: string, ip = '203.0.113.7') =>
  authorize({ email, password }, { headers: { 'x-forwarded-for': ip }, body: {}, query: {}, method: 'POST' });

async function failSignIns(count: number, email: (i: number) => string) {
  for (let i = 0; i < count; i++) expect(await signIn(email(i), 'wrong password')).toBeNull();
}

beforeEach(() => {
  // Date only: bcryptjs schedules its async work on setImmediate.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-03T09:00:00Z'));
  entries = [];
  entryIds = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('sign-in rate limit', () => {
  test('after 10 failed attempts for an email, even the right password is refused until the window passes', async () => {
    await failSignIns(10, () => 'sam@example.com');

    await expect(signIn('sam@example.com', PASSWORD)).rejects.toThrow(TOO_MANY_SIGN_IN_ATTEMPTS);

    jest.setSystemTime(Date.now() + WINDOW_MS + 1);
    expect(await signIn('sam@example.com', PASSWORD)).toMatchObject({ id: 'user-1' });
  });

  test('an email with no account is limited the same way', async () => {
    await failSignIns(10, () => 'nobody@example.com');

    await expect(signIn('nobody@example.com', 'wrong password')).rejects.toThrow(TOO_MANY_SIGN_IN_ATTEMPTS);
  });

  test('one IP is limited after 30 failed attempts across any emails, other IPs are not', async () => {
    await failSignIns(30, (i) => `guess-${i}@example.com`);

    await expect(signIn('sam@example.com', PASSWORD)).rejects.toThrow(TOO_MANY_SIGN_IN_ATTEMPTS);
    expect(await signIn('sam@example.com', PASSWORD, '198.51.100.20')).toMatchObject({ id: 'user-1' });
  });

  test('refused attempts skip the password check and do not push the block back', async () => {
    await failSignIns(10, () => 'sam@example.com');
    const compare = jest.spyOn(bcrypt, 'compare');

    jest.setSystemTime(Date.now() + WINDOW_MS - 60_000);
    for (let i = 0; i < 10; i++) {
      await expect(signIn('sam@example.com', 'another guess')).rejects.toThrow(TOO_MANY_SIGN_IN_ATTEMPTS);
    }
    expect(compare).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + 60_000 + 1);
    expect(await signIn('sam@example.com', PASSWORD)).toMatchObject({ id: 'user-1' });
  });

  test("a successful sign-in clears that email's failed attempts", async () => {
    await failSignIns(9, () => 'sam@example.com');
    expect(await signIn('sam@example.com', PASSWORD)).toMatchObject({ id: 'user-1' });

    await failSignIns(10, () => 'sam@example.com');
  });
});
