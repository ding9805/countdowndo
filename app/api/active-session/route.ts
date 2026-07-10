export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// GET: Retrieve the user's active session
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const active = await prisma.activeSession.findUnique({ where: { userId } });
    if (!active) {
      return NextResponse.json(null);
    }
    return NextResponse.json(active);
  } catch (error: any) {
    console.error('GET /api/active-session error:', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

// POST/PUT: Save or update the active session
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // Verify user exists to prevent foreign key violations
    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      console.error('POST /api/active-session: user not found in DB, userId:', userId);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
    const { tasks, sessionState, sessionStartMs, pausedElapsed, soundPlayed, sessionMode, sessionTotalSeconds } = body ?? {};

    const data = {
      tasks: tasks ?? [],
      sessionState: sessionState ?? 'running',
      sessionMode: sessionMode ?? 'continuous',
      sessionStartMs: sessionStartMs ?? Date.now(),
      pausedElapsed: pausedElapsed ?? 0,
      sessionTotalSeconds: sessionTotalSeconds ?? 0,
      soundPlayed: soundPlayed ?? [],
    };

    const active = await prisma.activeSession.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return NextResponse.json(active);
  } catch (error: any) {
    console.error('POST /api/active-session error:', error);
    return NextResponse.json({ error: 'Failed to save session' }, { status: 500 });
  }
}

// DELETE: End the active session
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    await prisma.activeSession.deleteMany({ where: { userId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/active-session error:', error);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
