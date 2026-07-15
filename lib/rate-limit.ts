import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

// NOTE: trusts the first x-forwarded-for hop. Safe on Vercel (its proxy
// rewrites the header), but behind a proxy that appends instead, this value
// is client-controlled and rate limits keyed on it become spoofable.
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
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

  // Opportunistic cleanup so the table doesn't grow forever: entries older
  // than a day are outside every window this app uses (the longest is 20
  // minutes). Awaited (a detached promise may never run on serverless), but
  // a failed sweep must not fail the request.
  await prisma.rateLimitEntry
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    .catch((e) => console.error('Rate-limit cleanup failed:', e));

  return { limited: false, waitSeconds: 0 };
}
