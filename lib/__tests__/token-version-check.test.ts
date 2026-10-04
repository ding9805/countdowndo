/**
 * Regression tests for how often a signed-in request reads the user's
 * tokenVersion from the database.
 *
 * The jwt callback re-read it once a minute, timed from a stamp kept in the
 * token. But getServerSession in a route handler can't write the cookie back,
 * so the stamp never moved on, and a minute after the cookie was last written
 * every request read the database (the 3s active-session poll included). The
 * last read is now remembered in memory for each user.
 */

import { authOptions } from '@/lib/auth';

type Token = Record<string, any>;

const mockUsers: { id: string; tokenVersion: number }[] = [];
let reads = 0;

// Just enough of the Prisma client for the jwt callback, counting reads.
const mockPrisma = {
  user: {
    findUnique: async ({ where }: any) => {
      reads++;
      const user = mockUsers.find((u) => u.id === where.id);
      return user ? { tokenVersion: user.tokenVersion } : null;
    },
  },
};

jest.mock('@/lib/db', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

const jwt = authOptions.callbacks!.jwt as unknown as (params: { token: Token; user?: Token }) => Promise<Token>;
const session = authOptions.callbacks!.session as unknown as (params: { session: Token; token: Token }) => Promise<Token>;

let userCount = 0;

// Signs a user in, returning the token their cookie holds.
async function signIn(user: { id: string; tokenVersion: number }) {
  return { ...(await jwt({ token: {}, user: { ...user, email: `${user.id}@example.com`, name: 'Sam' } })) };
}

async function newUser() {
  const user = { id: `user-${++userCount}`, tokenVersion: 0 };
  mockUsers.push(user);
  return { user, cookie: await signIn(user) };
}

// A request to an API route: next-auth decodes the cookie afresh and runs the
// callbacks, but can't write the token back, so the cookie never changes.
// Returns the signed-in user's id, or undefined when signed out.
async function request(cookie: Token): Promise<string | undefined> {
  const token = await jwt({ token: { ...cookie } });
  const result = await session({ session: { user: { email: cookie.email }, expires: '' }, token });
  return result.user?.id;
}

beforeEach(() => {
  jest.useFakeTimers();
  reads = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('checking a session against password resets', () => {
  test('requests read the database at most once a minute, though the cookie never changes', async () => {
    const { user, cookie } = await newUser();
    // Long enough that a stamp in the cookie would be out of date.
    jest.advanceTimersByTime(10 * 60_000);

    // Two minutes of the 3s active-session poll.
    for (let i = 0; i < 40; i++) {
      expect(await request(cookie)).toBe(user.id);
      jest.advanceTimersByTime(3_000);
    }

    expect(reads).toBe(2);
  });

  test('a password reset still signs other sessions out within a minute', async () => {
    const { user, cookie } = await newUser();
    expect(await request(cookie)).toBe(user.id);

    user.tokenVersion++; // what reset-password does
    jest.advanceTimersByTime(60_001);

    expect(await request(cookie)).toBeUndefined();
  });

  test('signing in again after a reset isn’t undone by the version remembered from before it', async () => {
    const { user, cookie: oldCookie } = await newUser();
    expect(await request(oldCookie)).toBe(user.id);

    user.tokenVersion++;
    const newCookie = await signIn(user);

    expect(await request(newCookie)).toBe(user.id);
  });

  test('each user’s version is remembered separately', async () => {
    const first = await newUser();
    const second = await newUser();
    expect(await request(first.cookie)).toBe(first.user.id);
    expect(await request(second.cookie)).toBe(second.user.id);

    second.user.tokenVersion++;
    jest.advanceTimersByTime(60_001);

    expect(await request(first.cookie)).toBe(first.user.id);
    expect(await request(second.cookie)).toBeUndefined();
  });
});
