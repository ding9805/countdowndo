export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { normalizeTags } from '@/lib/tag-utils';

async function getUserTagCorpus(userId: string): Promise<string[]> {
  const [tasks, templates] = await Promise.all([
    prisma.bankTask.findMany({ where: { userId }, select: { tags: true } }),
    prisma.bankTaskTemplate.findMany({ where: { userId }, select: { tags: true } }),
  ]);
  return [...tasks, ...templates].flatMap((t) => t.tags);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const tasks = await prisma.bankTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(tasks ?? []);
  } catch (error: any) {
    console.error('GET /api/task-bank error:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // Verify the session's user still exists to prevent foreign key violations
    // (e.g. a stale session whose account was deleted).
    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      return NextResponse.json({ error: 'Your session is no longer valid. Please log in again.' }, { status: 401 });
    }

    const body = await req.json();
    const { name, durationSeconds, color, tags } = body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Task name is required' }, { status: 400 });
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return NextResponse.json({ error: 'Duration must be a positive number of seconds' }, { status: 400 });
    }

    const corpus = await getUserTagCorpus(userId);
    const normalizedTags = normalizeTags(corpus, Array.isArray(tags) ? tags : []);

    const task = await prisma.bankTask.create({
      data: {
        userId,
        name: name.trim(),
        durationSeconds: Math.round(durationSeconds),
        color: color || 'orange',
        tags: normalizedTags,
      },
    });

    return NextResponse.json(task);
  } catch (error: any) {
    console.error('POST /api/task-bank error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
