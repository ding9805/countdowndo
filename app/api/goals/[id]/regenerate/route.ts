export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createCursorTask } from '@/lib/goal-service';
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

    const existing = await prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.bankTaskId) return NextResponse.json(existing); // already has a cursor
    if (isGoalComplete(existing)) {
      return NextResponse.json({ error: 'Goal is already complete' }, { status: 400 });
    }

    const goal = await prisma.$transaction((tx) => createCursorTask(tx, existing));
    return NextResponse.json(goal);
  } catch (error: any) {
    console.error('POST /api/goals/[id]/regenerate error:', error);
    return NextResponse.json({ error: 'Failed to regenerate task' }, { status: 500 });
  }
}
