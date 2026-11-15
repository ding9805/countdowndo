import { POST } from '@/app/api/auth/forgot-password/route';

// A real account's reset needs a DB write and an email send; an unknown
// address needs neither. That work runs after the answer goes out, so the
// response time doesn't reveal which addresses have accounts.

let knownEmails = new Set<string>();
const deferred: Promise<unknown>[] = [];

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

jest.mock('@vercel/functions', () => ({
  waitUntil: (promise: Promise<unknown>) => {
    deferred.push(promise);
  },
}));

// The send never settles until released, so a route that awaited it would
// never answer.
let releaseSend: () => void = () => {};
const sendEmail = jest.fn(
  () => new Promise<Response>((resolve) => {
    releaseSend = () => resolve(new Response('{}', { status: 200 }));
  })
);

beforeEach(() => {
  knownEmails = new Set(['reader@example.com']);
  deferred.length = 0;
  sendEmail.mockClear();
  global.fetch = sendEmail as unknown as typeof fetch;
});

function request(email: string) {
  const req = new Request('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return POST(req as any);
}

test.each([
  ['an address with an account', 'reader@example.com', 1],
  ['an address without one', 'nobody@example.com', 0],
])('%s is answered without waiting on the email send', async (_label, email, emailsSent) => {
  const res = await request(email);
  expect(await res.json()).toEqual({ success: true });

  expect(deferred).toHaveLength(emailsSent);
  // Let the deferred token write reach the send.
  await new Promise((resolve) => setImmediate(resolve));
  expect(sendEmail).toHaveBeenCalledTimes(emailsSent);

  releaseSend();
  await Promise.all(deferred);
});
