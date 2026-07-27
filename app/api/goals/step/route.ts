export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { goalStepSchema, formatZodError } from '@/lib/schemas';
import { stepGoal } from '@/lib/goal-service';

// Postgres aborts one of two conflicting serializable transactions with
// 40001, which Prisma surfaces as P2034. That's an expected outcome under
// concurrency, not a failure — re-run the whole transaction (fresh read
// included) a couple of times before giving up.
const SERIALIZATION_RETRIES = 3;

async function withSerializableRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error: any) {
      const isConflict = error?.code === 'P2034' || error?.meta?.code === '40001';
      if (!isConflict || attempt >= SERIALIZATION_RETRIES) throw error;
    }
  }
}

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

    // The read has to happen INSIDE the transaction: stepGoal derives the new
    // currentValue from the row it's handed, so reading outside would let two
    // concurrent steps (rapid done/undo, or two tabs) both start from the same
    // value and lose one interval. Serializable makes the DB reject the second
    // one instead, and we retry it against fresh state.
    const updated = await withSerializableRetry(() =>
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
          return stepGoal(tx, goal, direction === 'advance' ? 1 : -1);
        },
        { isolationLevel: 'Serializable' }
      )
    );

    return NextResponse.json({ goal: updated });
  } catch (error: any) {
    console.error('POST /api/goals/step error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}
