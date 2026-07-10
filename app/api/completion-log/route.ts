export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: Fetch completion logs for the past 60 days
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    cutoff.setHours(0, 0, 0, 0);

    const logs = await prisma.completionLog.findMany({
      where: {
        userId: session.user.id,
        completedAt: { gte: cutoff },
      },
      orderBy: { completedAt: 'desc' },
    });

    return NextResponse.json(logs);
  } catch (error) {
    console.error('GET completion-log error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Log completed tasks
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tasks } = await req.json();
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return NextResponse.json({ error: 'No tasks provided' }, { status: 400 });
    }

    // Create completion logs for each task
    const logs = await prisma.completionLog.createMany({
      data: tasks.map((t: { name: string; durationSeconds: number; completedAt?: string; color?: string }) => ({
        taskName: t.name,
        durationSeconds: t.durationSeconds,
        color: t.color ?? null,
        completedAt: t.completedAt ? new Date(t.completedAt) : new Date(),
        userId: session.user.id,
      })),
    });

    // Cleanup: delete logs older than 60 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    cutoff.setHours(0, 0, 0, 0);

    await prisma.completionLog.deleteMany({
      where: {
        userId: session.user.id,
        completedAt: { lt: cutoff },
      },
    });

    return NextResponse.json({ count: logs.count });
  } catch (error) {
    console.error('POST completion-log error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Remove a specific completion log entry
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'No id provided' }, { status: 400 });
    }

    // Ensure the log belongs to the user
    const log = await prisma.completionLog.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!log) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.completionLog.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE completion-log error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
