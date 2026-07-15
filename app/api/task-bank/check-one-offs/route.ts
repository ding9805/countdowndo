export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkOneOffBankTasksSchema, formatZodError } from '@/lib/schemas';

// Soft-delete toggle for one-off bank tasks as they're checked/unchecked in a
// running session. done=true stamps completedAt so the task disappears from
// the bank immediately (only on rows that are currently one-off — the server
// checks the live flag, not the client's add-time snapshot); done=false clears
// it, restoring the row after an accidental check-off. The hard delete happens
// at session end via complete-one-offs.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json();
    const parsed = checkOneOffBankTasksSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { bankTaskIds, done } = parsed.data;

    const { count } = done
      ? await prisma.bankTask.updateMany({
          where: { id: { in: bankTaskIds }, userId, isOneOff: true },
          data: { completedAt: new Date() },
        })
      : // No isOneOff filter on restore: if the flag was toggled off while the
        // row sat soft-deleted, unchecking should still bring it back.
        await prisma.bankTask.updateMany({
          where: { id: { in: bankTaskIds }, userId },
          data: { completedAt: null },
        });

    return NextResponse.json({ count });
  } catch (error: any) {
    console.error('POST /api/task-bank/check-one-offs error:', error);
    return NextResponse.json({ error: 'Failed to update one-off bank tasks' }, { status: 500 });
  }
}
