export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeOneOffBankTasksSchema, formatZodError } from '@/lib/schemas';

// Batch-delete bank tasks that are currently one-off. The client sends every
// completed session task's bankTaskId; the server filters by the live `isOneOff`
// flag and the current user, so stale client snapshots can't suppress deletion.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json();
    const parsed = completeOneOffBankTasksSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { bankTaskIds } = parsed.data;

    const { count } = bankTaskIds.length > 0
      ? await prisma.bankTask.deleteMany({
          where: {
            id: { in: bankTaskIds },
            userId,
            isOneOff: true,
          },
        })
      : { count: 0 };

    // Restore any remaining soft-deleted rows. A row can be left stranded with
    // completedAt set if an uncheck request failed mid-session, or if a task
    // was checked done but the session ended with it unchecked on another
    // device. The user has one active session at a time, so once it ends
    // every surviving row should be visible again.
    const { count: restored } = await prisma.bankTask.updateMany({
      where: { userId, completedAt: { not: null } },
      data: { completedAt: null },
    });

    return NextResponse.json({ count, restored });
  } catch (error: any) {
    console.error('POST /api/task-bank/complete-one-offs error:', error);
    return NextResponse.json({ error: 'Failed to complete one-off bank tasks' }, { status: 500 });
  }
}
