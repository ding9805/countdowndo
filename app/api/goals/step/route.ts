export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { goalStepSchema, formatZodError } from '@/lib/schemas';
import { stepGoal } from '@/lib/goal-service';

// Called by the session engine when a bank-linked task is marked done
// (advance) or un-marked (retreat). Resolves the goal by the unique
// bankTaskId server-side; a task that isn't a goal cursor is a no-op, so the
// engine can call this for every bank-linked task without pre-filtering.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const body = await req.json();
    const parsed = goalStepSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { bankTaskId, direction } = parsed.data;

    // Match on lastBankTaskId too: after the completing step deletes the
    // cursor task, bankTaskId is null but the session task still holds the
    // old id — undo (and re-advance from a stale session task) must resolve.
    const goal = await prisma.goal.findFirst({
      where: { userId, OR: [{ bankTaskId }, { lastBankTaskId: bankTaskId }] },
    });
    if (!goal) return NextResponse.json({ goal: null });

    const updated = await prisma.$transaction((tx) =>
      stepGoal(tx, goal, direction === 'advance' ? 1 : -1)
    );
    return NextResponse.json({ goal: updated });
  } catch (error: any) {
    console.error('POST /api/goals/step error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}
