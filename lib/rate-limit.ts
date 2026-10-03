import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

// A route handler's Headers, or the plain header record next-auth passes to
// `authorize`.
type HeaderSource = NextRequest['headers'] | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderSource | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return (headers as NextRequest['headers']).get(name) ?? undefined;
  const value = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

// NOTE: trusts the first x-forwarded-for hop. Safe on Vercel (its proxy
// rewrites the header), but behind a proxy that appends instead, this value
// is client-controlled and rate limits keyed on it become spoofable.
export function getClientIp(req: { headers?: HeaderSource }): string {
  return (
    readHeader(req.headers, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    readHeader(req.headers, 'x-real-ip') ||
    'unknown'
  );
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value + (process.env.NEXTAUTH_SECRET || 'salt')).digest('hex');
}

// Checks whether `key` (an IP or email, hashed before storage) has hit
// `scope` within the last `windowSeconds`. If not rate-limited, records this
// attempt immediately so the check-then-record isn't racy under concurrent
// requests from the same key.
export async function checkAndRecordRateLimit(
  scope: string,
  key: string,
  windowSeconds: number
): Promise<{ limited: boolean; waitSeconds: number }> {
  const keyHash = hashValue(key);
  const recent = await prisma.rateLimitEntry.findFirst({
    where: { scope, keyHash, createdAt: { gte: new Date(Date.now() - windowSeconds * 1000) } },
    orderBy: { createdAt: 'desc' },
  });

  if (recent) {
    const waitSeconds = Math.ceil(
      (windowSeconds * 1000 - (Date.now() - recent.createdAt.getTime())) / 1000
    );
    return { limited: true, waitSeconds: Math.max(1, waitSeconds) };
  }

  await prisma.rateLimitEntry.create({ data: { scope, keyHash } });
  await sweepExpiredEntries();

  return { limited: false, waitSeconds: 0 };
}

// Sliding-window limit allowing up to `maxAttempts` per window, for scopes
// that need more than checkAndRecordRateLimit's one. The attempt is recorded
// before counting, so concurrent requests see each other instead of all
// slipping in under the limit together; its entry id is returned so the
// caller can take the attempt back if it turns out not to count.
export async function recordAttempt(
  scope: string,
  key: string,
  windowSeconds: number,
  maxAttempts: number
): Promise<{ limited: boolean; entryId: string }> {
  const keyHash = hashValue(key);
  const { id } = await prisma.rateLimitEntry.create({ data: { scope, keyHash } });
  const attempts = await prisma.rateLimitEntry.count({
    where: { scope, keyHash, createdAt: { gte: new Date(Date.now() - windowSeconds * 1000) } },
  });
  await sweepExpiredEntries();
  return { limited: attempts > maxAttempts, entryId: id };
}

export async function deleteRateLimitEntries(entryIds: string[]): Promise<void> {
  await prisma.rateLimitEntry.deleteMany({ where: { id: { in: entryIds } } });
}

// Forgets every attempt `key` has made at `scope`.
export async function clearRateLimit(scope: string, key: string): Promise<void> {
  await prisma.rateLimitEntry.deleteMany({ where: { scope, keyHash: hashValue(key) } });
}

// Opportunistic cleanup so the table doesn't grow forever: entries older
// than a day are outside every window this app uses (the longest is 20
// minutes). Awaited (a detached promise may never run on serverless), but
// a failed sweep must not fail the request.
async function sweepExpiredEntries(): Promise<void> {
  await prisma.rateLimitEntry
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    .catch((e) => console.error('Rate-limit cleanup failed:', e));
}
