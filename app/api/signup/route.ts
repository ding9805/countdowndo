export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { checkAndRecordRateLimit, getClientIp } from '@/lib/rate-limit';

// Allows one signup per IP every 12 minutes — effectively 5/hour, without
// needing a sliding-window counter for a single-entry-per-window check.
const SIGNUP_RATE_LIMIT_SECONDS = (60 * 60) / 5;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = body ?? {};

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Rate limit by IP to slow down mass account creation. Checked (and only
    // recorded) after basic validation so malformed requests don't burn the quota.
    const ip = getClientIp(req);
    const { limited } = await checkAndRecordRateLimit('signup:ip', ip, SIGNUP_RATE_LIMIT_SECONDS);
    if (limited) {
      return NextResponse.json({ error: 'Too many signup attempts. Please try again later.' }, { status: 429 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase().trim(),
          name: name?.trim() || null,
          hashedPassword,
        },
      });
    } catch (createError: any) {
      // Two requests can both pass the findUnique check above before either
      // creates the row — the unique constraint is the real guard. Without
      // this, a concurrent duplicate signup falls through to the generic
      // 500 handler instead of the same friendly message as a sequential one.
      if (createError?.code === 'P2002') {
        return NextResponse.json({ error: 'An account with this email already exists' }, { status: 400 });
      }
      throw createError;
    }

    return NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Signup failed' }, { status: 500 });
  }
}
