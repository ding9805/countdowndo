export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const lists = await prisma.savedList.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(lists ?? []);
  } catch (error: any) {
    console.error('GET /api/saved-lists error:', error);
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

    const body = await req.json();
    const { name, tasks } = body ?? {};

    if (!name || !tasks) {
      return NextResponse.json({ error: 'Name and tasks are required' }, { status: 400 });
    }

    const count = await prisma.savedList.count({ where: { userId } });
    if (count >= 3) {
      return NextResponse.json({ error: 'Maximum 3 saved lists allowed. Delete one first.' }, { status: 400 });
    }

    const list = await prisma.savedList.create({
      data: { name, tasks, userId },
    });

    return NextResponse.json(list);
  } catch (error: any) {
    console.error('POST /api/saved-lists error:', error);
    return NextResponse.json({ error: 'Failed to create list' }, { status: 500 });
  }
}
