import { checkAndRecordRateLimit } from '@/lib/rate-limit';

type Entry = { scope: string; keyHash: string; createdAt: Date };
let entries: Entry[] = [];
let locks = new Map<bigint, Promise<void>>();
let failNextInsert = false;

function entryClient(pending: Entry[] = entries) {
  return {
    findFirst: async ({ where }: any) =>
      entries
        .filter((entry) => entry.scope === where.scope && entry.keyHash === where.keyHash && entry.createdAt >= where.createdAt.gte)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
    create: async ({ data }: any) => {
      if (failNextInsert) {
        failNextInsert = false;
        throw new Error('insert failed');
      }
      const entry = { ...data, createdAt: new Date() };
      pending.push(entry);
      return entry;
    },
    deleteMany: async () => ({ count: 0 }),
  };
}

// Model committed reads and transaction-scoped advisory locks. Without a
// lock, concurrent calls all read the empty table before any inserts commit.
// With a lock, the next caller sees the previous transaction's committed row.
async function transaction(run: (tx: any) => Promise<unknown>, options?: { isolationLevel?: string }) {
  expect(options?.isolationLevel).toBe('ReadCommitted');
  const pending: Entry[] = [];
  const releases: (() => void)[] = [];
  try {
    const result = await run({
      rateLimitEntry: entryClient(pending),
      $executeRaw: async (_sql: TemplateStringsArray, lockId: bigint) => {
        const previous = locks.get(lockId) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const tail = previous.then(() => held);
        locks.set(lockId, tail);
        await previous;
        releases.push(() => {
          release();
          if (locks.get(lockId) === tail) locks.delete(lockId);
        });
        return 1;
      },
    });
    entries.push(...pending);
    return result;
  } finally {
    releases.forEach((release) => release());
  }
}

jest.mock('@/lib/db', () => ({
  prisma: {
    $transaction: (run: any, options: any) => transaction(run, options),
    get rateLimitEntry() { return entryClient(); },
  },
}));

beforeEach(() => {
  entries = [];
  locks = new Map();
  failNextInsert = false;
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-11T00:00:00Z'));
});

afterEach(() => jest.useRealTimers());

test.each([
  ['signup:ip', 720],
  ['forgot-password:ip', 720],
  ['forgot-password:email', 1200],
])('%s admits only one of 20 simultaneous attempts', async (scope, windowSeconds) => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => checkAndRecordRateLimit(scope, 'same-key', windowSeconds))
  );
  expect(results.filter((result) => !result.limited)).toHaveLength(1);
  expect(results.filter((result) => result.limited)).toEqual(
    Array.from({ length: 19 }, () => ({ limited: true, waitSeconds: windowSeconds }))
  );
  expect(entries).toHaveLength(1);
});

test('blocked requests do not extend the window, and expiry allows exactly one new attempt', async () => {
  await checkAndRecordRateLimit('signup:ip', 'same-key', 720);
  jest.setSystemTime(Date.now() + 719_000);
  expect(await checkAndRecordRateLimit('signup:ip', 'same-key', 720)).toEqual({ limited: true, waitSeconds: 1 });
  expect(entries).toHaveLength(1);

  jest.setSystemTime(Date.now() + 1_001);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => checkAndRecordRateLimit('signup:ip', 'same-key', 720))
  );
  expect(results.filter((result) => !result.limited)).toHaveLength(1);
  expect(entries).toHaveLength(2);
});

test('different keys and scopes have independent quotas', async () => {
  const results = await Promise.all([
    checkAndRecordRateLimit('signup:ip', 'key-a', 720),
    checkAndRecordRateLimit('signup:ip', 'key-b', 720),
    checkAndRecordRateLimit('forgot-password:ip', 'key-a', 720),
  ]);
  expect(results.every((result) => !result.limited)).toBe(true);
  expect(entries).toHaveLength(3);
});

test('a failed insert rejects the attempt and releases the transaction lock', async () => {
  failNextInsert = true;
  await expect(checkAndRecordRateLimit('signup:ip', 'same-key', 720)).rejects.toThrow('insert failed');
  expect(entries).toHaveLength(0);
  expect(locks.size).toBe(0);
  expect(await checkAndRecordRateLimit('signup:ip', 'same-key', 720)).toEqual({ limited: false, waitSeconds: 0 });
});
