export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { goalUpdateSchema, formatZodError } from '@/lib/schemas';
import { syncCursorTask } from '@/lib/goal-service';
import { clampGoalValue, isGoalComplete } from '@/lib/goal-utils';
import { getUserTagCorpus, normalizeTags } from '@/lib/tag-utils';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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

    const body = await req.json();
    const parsed = goalUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const merged = {
      ...existing,
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    };
    if (merged.targetValue <= merged.startValue) {
      return NextResponse.json({ error: 'Target must be greater than the starting value' }, { status: 400 });
    }
    // Clamp progress into the (possibly new) range, then recompute completion.
    merged.currentValue = clampGoalValue(merged.currentValue, merged);
    const complete = isGoalComplete(merged);

    // Normalize tags only when provided — a progress-only edit (just
    // currentValue) skips the corpus fetch entirely, mirroring the bank-task
    // PUT. Excluding this goal's id lets a solo tag rename change casing.
    const normalizedTags = data.tags !== undefined
      ? normalizeTags(await getUserTagCorpus(userId, { excludeGoalId: id }), data.tags)
      : undefined;

    const goal = await prisma.$transaction(async (tx) => {
      const updated = await tx.goal.update({
        where: { id },
        data: {
          name: merged.name,
          unit: merged.unit,
          startValue: merged.startValue,
          targetValue: merged.targetValue,
          currentValue: merged.currentValue,
          intervals: merged.intervals,
          intervalSeconds: Math.round(merged.intervalSeconds),
          color: merged.color,
          dueDate: merged.dueDate,
          completedAt: complete ? (existing.completedAt ?? new Date()) : null,
          ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
        },
      });
      // forceCreate only when the edit un-completes a previously complete goal
      // (its cursor was deleted at completion and must come back). An orphaned
      // incomplete goal stays orphaned on plain edits — that's what the
      // explicit Regenerate action is for.
      const wasComplete = existing.completedAt !== null;
      return syncCursorTask(tx, updated, { forceCreate: wasComplete && !complete });
    });

    return NextResponse.json(goal);
  } catch (error: any) {
    console.error('PUT /api/goals/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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

    await prisma.$transaction(async (tx) => {
      await tx.goal.delete({ where: { id } });
      if (existing.bankTaskId) {
        await tx.bankTask.deleteMany({ where: { id: existing.bankTaskId, userId } });
      }
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/goals/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 });
  }
}
