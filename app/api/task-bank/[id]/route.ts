export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { normalizeTags } from '@/lib/tag-utils';
import { bankTaskUpdateSchema, formatZodError } from '@/lib/schemas';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const existing = await prisma.bankTask.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const parsed = bankTaskUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { name, durationSeconds, color, tags, isOneOff, dueDate } = parsed.data;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (durationSeconds !== undefined) updateData.durationSeconds = Math.round(durationSeconds);
    if (color !== undefined) updateData.color = color;
    if (isOneOff !== undefined) updateData.isOneOff = isOneOff;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (tags !== undefined) {
      const [taskRows, templateRows] = await Promise.all([
        prisma.bankTask.findMany({ where: { userId, id: { not: id } }, select: { tags: true } }),
        prisma.bankTaskTemplate.findMany({ where: { userId }, select: { tags: true } }),
      ]);
      const corpus = [...taskRows, ...templateRows].flatMap((t) => t.tags);
      updateData.tags = normalizeTags(corpus, tags);
    }

    const task = await prisma.bankTask.update({ where: { id }, data: updateData });
    return NextResponse.json(task);
  } catch (error: any) {
    console.error('PUT /api/task-bank/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
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

    const existing = await prisma.bankTask.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.bankTask.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/task-bank/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
