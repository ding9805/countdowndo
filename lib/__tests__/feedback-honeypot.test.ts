/**
 * Tests for the feedback form's spam trap.
 *
 * The form has a hidden "website" field that people never see. It always
 * sent an empty value, whatever a bot typed there, so the trap never caught
 * anything; it now sends what's in the field. These tests pin down the
 * server's half: a filled-in trap gets the usual thank-you, so a bot can't
 * tell, but nothing is stored or emailed.
 */

import { POST } from '@/app/api/feedback/route';

let stored: Record<string, any>[] = [];

jest.mock('@/lib/db', () => ({
  prisma: {
    feedback: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const row = { id: `feedback-${stored.length + 1}`, createdAt: new Date(), ...data };
        stored.push(row);
        return row;
      },
    },
  },
}));

const sendEmail = jest.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  stored = [];
  sendEmail.mockClear();
  global.fetch = sendEmail as unknown as typeof fetch;
});

function submit(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  });
  return POST(req as any);
}

const feedback = { category: 'bug', message: 'The timer skipped a task.' };

describe('the feedback spam trap', () => {
  test('a submission with the hidden field filled in is thanked, but not stored or emailed', async () => {
    const res = await submit({ ...feedback, website: 'https://spam.example' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(stored).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a submission with the hidden field empty is stored and emailed', async () => {
    const res = await submit({ ...feedback, website: '' });

    expect(res.status).toBe(200);
    expect(stored).toEqual([expect.objectContaining(feedback)]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
