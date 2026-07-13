import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

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
  return { limited: false, waitSeconds: 0 };
}
