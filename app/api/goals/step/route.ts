export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { goalStepSchema, formatZodError } from '@/lib/schemas';
import { stepGoal, withSerializableRetry, SERIALIZABLE } from '@/lib/goal-service';

// Called by the session engine when a bank-linked task is marked done
// (advance) or un-marked (retreat). Resolves the goal by the unique
// bankTaskId server-side; a task that isn't a goal cursor is a no-op, so the
// engine can call this for every bank-linked task without pre-filtering.
// `moved` says whether the goal's progress actually changed: advancing a goal
// that's already complete changes nothing, and the engine then knows not to
// roll it back when that task is un-marked.
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

    // The read has to happen INSIDE the transaction: stepGoal derives the new
    // currentValue from the row it's handed, so reading outside would let two
    // concurrent steps (rapid done/undo, or two tabs) both start from the same
    // value and lose one interval. See withSerializableRetry in goal-service.
    const result = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          // Match on lastBankTaskId too: after the completing step deletes the
          // cursor task, bankTaskId is null but the session task still holds
          // the old id — undo (and re-advance from a stale session task) must
          // resolve.
          const goal = await tx.goal.findFirst({
            where: { userId, OR: [{ bankTaskId }, { lastBankTaskId: bankTaskId }] },
          });
          if (!goal) return null;
          const before = goal.currentValue;
          const updated = await stepGoal(tx, goal, direction === 'advance' ? 1 : -1);
          return { goal: updated, moved: updated.currentValue !== before };
        },
        SERIALIZABLE
      )
    );

    return NextResponse.json(result ?? { goal: null, moved: false });
  } catch (error: any) {
    console.error('POST /api/goals/step error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}
