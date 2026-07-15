import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { hashResetToken } from '@/lib/reset-token';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invalid reset token' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }
    // bcrypt only uses the first 72 bytes — same cap as signup.
    if (password.length > 72) {
      return NextResponse.json({ error: 'Password must be at most 72 characters' }, { status: 400 });
    }

    // Find user with this token that hasn't expired
    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashResetToken(token),
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset link. Please request a new one.' }, { status: 400 });
    }

    // Hash the new password and clear the reset token
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        // Invalidates any existing sessions (e.g. an attacker's, if that's why
        // the password was reset) — see the jwt callback in lib/auth.ts.
        tokenVersion: { increment: 1 },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
