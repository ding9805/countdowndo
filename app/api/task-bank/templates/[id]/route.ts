export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { normalizeTags } from '@/lib/tag-utils';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const existing = await prisma.bankTaskTemplate.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { name, durationSeconds, color, tags } = body ?? {};

    const updateData: any = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Template name cannot be empty' }, { status: 400 });
      }
      updateData.name = name.trim();
    }
    if (durationSeconds !== undefined) {
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return NextResponse.json({ error: 'Duration must be a positive number of seconds' }, { status: 400 });
      }
      updateData.durationSeconds = Math.round(durationSeconds);
    }
    if (color !== undefined) updateData.color = color;
    if (tags !== undefined) {
      const [taskRows, templateRows] = await Promise.all([
        prisma.bankTask.findMany({ where: { userId }, select: { tags: true } }),
        prisma.bankTaskTemplate.findMany({ where: { userId, id: { not: id } }, select: { tags: true } }),
      ]);
      const corpus = [...taskRows, ...templateRows].flatMap((t) => t.tags);
      updateData.tags = normalizeTags(corpus, Array.isArray(tags) ? tags : []);
    }

    const template = await prisma.bankTaskTemplate.update({ where: { id }, data: updateData });
    return NextResponse.json(template);
  } catch (error: any) {
    console.error('PUT /api/task-bank/templates/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
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

    const existing = await prisma.bankTaskTemplate.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.bankTaskTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/task-bank/templates/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  }
}
