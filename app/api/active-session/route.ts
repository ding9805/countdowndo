export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { activeSessionPayloadSchema, formatZodError } from '@/lib/schemas';

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
    const parsed = activeSessionPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { lastKnownUpdatedAt, ...data } = parsed.data;

    // Optimistic concurrency: if this client last saw the row at some point,
    // and the row has since been updated more recently than that (another
    // device/tab wrote in between), reject instead of silently clobbering
    // that write with a full-state overwrite computed from stale data.
    if (lastKnownUpdatedAt) {
      const existing = await prisma.activeSession.findUnique({
        where: { userId },
        select: { updatedAt: true },
      });
      if (existing && existing.updatedAt.getTime() > new Date(lastKnownUpdatedAt).getTime()) {
        const latest = await prisma.activeSession.findUnique({ where: { userId } });
        return NextResponse.json(
          { error: 'Session was updated elsewhere', conflict: true, latest },
          { status: 409 }
        );
      }
    }

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
