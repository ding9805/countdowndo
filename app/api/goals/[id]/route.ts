export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { goalUpdateSchema, formatZodError } from '@/lib/schemas';
import { syncCursorTask, withSerializableRetry, SERIALIZABLE } from '@/lib/goal-service';
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

    const body = await req.json();
    const parsed = goalUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // Pre-read only to reject unknown/foreign ids before doing any work, and
    // to scope the tag corpus. The authoritative read happens inside the
    // transaction below — this snapshot is never merged into the update.
    const preRead = await prisma.goal.findFirst({ where: { id, userId } });
    if (!preRead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Normalize tags only when provided — a progress-only edit (just
    // currentValue) skips the corpus fetch entirely, mirroring the bank-task
    // PUT. Excluding this goal's id lets a solo tag rename change casing; the
    // linked cursor task carries a copy of those same tags, so it has to be
    // excluded too or it would pin the old casing right back.
    const normalizedTags = data.tags !== undefined
      ? normalizeTags(
          await getUserTagCorpus(userId, {
            excludeGoalId: id,
            excludeBankTaskId: preRead.bankTaskId ?? undefined,
          }),
          data.tags
        )
      : undefined;

    // Same read-modify-write hazard as the step route: currentValue is clamped
    // against the row's own range and completion is derived from it, so the
    // read must be inside the transaction. Otherwise a concurrent step (a task
    // completed in a session) and an edit here both build on the same snapshot
    // and one write is lost.
    const result = await withSerializableRetry(() =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.goal.findFirst({ where: { id, userId } });
        if (!existing) return { error: 'Not found', status: 404 } as const;

        const merged = {
          ...existing,
          ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        };
        if (merged.targetValue <= merged.startValue) {
          return { error: 'Target must be greater than the starting value', status: 400 } as const;
        }
        // Clamp progress into the (possibly new) range, then recompute
        // completion. Progress is deliberately NOT snapped onto the new
        // interval grid — that would rewrite what the user actually did. The
        // discrepancy is absorbed by the next chunk instead: stepGoal advances
        // to the next grid boundary, so one corrective task brings the count
        // back to whole numbers.
        merged.currentValue = clampGoalValue(merged.currentValue, merged);
        const complete = isGoalComplete(merged);

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
        const goal = await syncCursorTask(tx, updated, { forceCreate: wasComplete && !complete });
        return { goal } as const;
      }, SERIALIZABLE)
    );

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.goal);
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
