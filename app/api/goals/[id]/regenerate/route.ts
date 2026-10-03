export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createCursorTask, withSerializableRetry, SERIALIZABLE } from '@/lib/goal-service';
import { isGoalComplete } from '@/lib/goal-utils';

// Recreates the cursor bank task for an orphaned goal (its task was deleted
// directly from the bank — the FK is SetNull, so the goal survives).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    // The read has to happen inside the transaction: two requests at once (a
    // double-click) would otherwise both see no cursor and both create one.
    // At Serializable, the one that loses the race is rolled back and re-run,
    // and then finds the cursor the other made. See withSerializableRetry.
    const result = await withSerializableRetry(() =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.goal.findFirst({ where: { id, userId } });
        if (!existing) return null;
        if (existing.bankTaskId) return existing; // already has a cursor
        if (isGoalComplete(existing)) return 'complete' as const;
        return createCursorTask(tx, existing);
      }, SERIALIZABLE)
    );
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (result === 'complete') {
      return NextResponse.json({ error: 'Goal is already complete' }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('POST /api/goals/[id]/regenerate error:', error);
    return NextResponse.json({ error: 'Failed to regenerate task' }, { status: 500 });
  }
}
