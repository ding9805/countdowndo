import { POST } from '@/app/api/auth/forgot-password/route';

// A real account's answer waits on a DB write and the email send; an unknown
// address's doesn't. Both are held to the same minimum time so the response
// time doesn't reveal which addresses have accounts.

let knownEmails = new Set<string>();

jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: any) =>
        knownEmails.has(where.email) ? { id: 'user-1', email: where.email } : null,
      update: async () => ({}),
    },
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '203.0.113.7',
  checkAndRecordRateLimit: async () => ({ limited: false, waitSeconds: 0 }),
}));

const sendEmail = jest.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  jest.useFakeTimers();
  knownEmails = new Set(['reader@example.com']);
  sendEmail.mockClear();
  global.fetch = sendEmail as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

function request(email: string) {
  const req = new Request('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  let settled = false;
  const response = POST(req as any).then((res) => {
    settled = true;
    return res;
  });
  return { response, isSettled: () => settled };
}

test.each([
  ['an address with an account', 'reader@example.com', 1],
  ['an address without one', 'nobody@example.com', 0],
])('%s gets its answer after the same minimum time', async (_label, email, emailsSent) => {
  const { response, isSettled } = request(email);

  await jest.advanceTimersByTimeAsync(1499);
  expect(isSettled()).toBe(false);

  await jest.advanceTimersByTimeAsync(1);
  const res = await response;
  expect(isSettled()).toBe(true);
  expect(await res.json()).toEqual({ success: true });
  expect(sendEmail).toHaveBeenCalledTimes(emailsSent);
});
