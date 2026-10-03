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

    // Optimistic concurrency. A save is a full-state overwrite computed from
    // the version of the row this client last saw, so it may only replace
    // that exact version, and a client that has seen no row may only create
    // one. Anything else — another device/tab wrote in between, or a Stop
    // deleted the row — means the client is working from stale state, so
    // reject with the latest row (null if gone) for it to adopt. The version
    // check is part of the write itself: checking first and writing second
    // would let two concurrent saves both pass and the later one clobber
    // the earlier.
    let active;
    if (lastKnownUpdatedAt) {
      active = await prisma.$transaction(async (tx) => {
        const { count } = await tx.activeSession.updateMany({
          where: { userId, updatedAt: new Date(lastKnownUpdatedAt) },
          data,
        });
        // Read back in the same transaction, which still holds the row lock
        // from the update, so this returns our write and not a later one.
        return count === 1 ? tx.activeSession.findUnique({ where: { userId } }) : null;
      });
    } else {
      active = await prisma.activeSession.create({ data: { userId, ...data } }).catch((error) => {
        if (error?.code === 'P2002') return null; // a row already exists
        throw error;
      });
    }

    if (!active) {
      const latest = await prisma.activeSession.findUnique({ where: { userId } });
      return NextResponse.json(
        { error: 'Session was updated elsewhere', conflict: true, latest },
        { status: 409 }
      );
    }

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
