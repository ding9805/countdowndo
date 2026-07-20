export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { goalCreateSchema, formatZodError } from '@/lib/schemas';
import { createCursorTask } from '@/lib/goal-service';
import { todayLocalDateString } from '@/lib/goal-utils';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // Active goals first, then completed; newest first within each group.
    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    return NextResponse.json(goals ?? []);
  } catch (error: any) {
    console.error('GET /api/goals error:', error);
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
    const parsed = goalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { name, unit, startValue, targetValue, intervals, intervalSeconds, color, dueDate } = parsed.data;

    try {
      const goal = await prisma.$transaction(async (tx) => {
        const created = await tx.goal.create({
          data: {
            userId,
            name,
            unit,
            startValue,
            targetValue,
            currentValue: startValue,
            intervals,
            intervalSeconds: Math.round(intervalSeconds),
            color: color || 'orange',
            startDate: todayLocalDateString(),
            dueDate,
          },
        });
        return createCursorTask(tx, created);
      });
      return NextResponse.json(goal);
    } catch (createError: any) {
      // P2003: the session's user row no longer exists (see task-bank POST).
      if (createError?.code === 'P2003') {
        return NextResponse.json({ error: 'Your session is no longer valid. Please log in again.' }, { status: 401 });
      }
      throw createError;
    }
  } catch (error: any) {
    console.error('POST /api/goals error:', error);
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }
}
