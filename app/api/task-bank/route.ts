export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserTagCorpus, normalizeTags } from '@/lib/tag-utils';
import { bankTaskCreateSchema, formatZodError } from '@/lib/schemas';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // completedAt-set rows are one-offs checked done in a running session —
    // soft-deleted, pending the session-end sweep. Hide them so they vanish
    // from the bank immediately at check-off.
    const tasks = await prisma.bankTask.findMany({
      where: { userId, completedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(tasks ?? []);
  } catch (error: any) {
    console.error('GET /api/task-bank error:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const parsed = bankTaskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { name, durationSeconds, color, tags, isOneOff, dueDate } = parsed.data;

    // Only fetch the tag corpus when tags were actually provided — the common
    // case (no tags) skips two findMany round-trips entirely.
    const normalizedTags = tags && tags.length > 0
      ? normalizeTags(await getUserTagCorpus(userId), tags)
      : [];

    try {
      const task = await prisma.bankTask.create({
        data: {
          userId,
          name,
          durationSeconds: Math.round(durationSeconds),
          color: color || 'orange',
          tags: normalizedTags,
          isOneOff: isOneOff ?? false,
          dueDate: dueDate ?? null,
        },
      });

      return NextResponse.json(task);
    } catch (createError: any) {
      // P2003 = foreign-key constraint violation. If the session's user was
      // deleted between the JWT issuing and this insert, the FK on userId
      // fails here — same end state as the old pre-check, just one fewer
      // round-trip in the common case.
      if (createError?.code === 'P2003') {
        return NextResponse.json({ error: 'Your session is no longer valid. Please log in again.' }, { status: 401 });
      }
      throw createError;
    }
  } catch (error: any) {
    console.error('POST /api/task-bank error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
