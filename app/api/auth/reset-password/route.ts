import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { hashResetToken } from '@/lib/reset-token';
import { passwordSchema, formatZodError } from '@/lib/schemas';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invalid reset token' }, { status: 400 });
    }

    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) {
      return NextResponse.json({ error: formatZodError(parsedPassword.error) }, { status: 400 });
    }

    // Reject invalid tokens before spending time hashing the password.
    const tokenHash = hashResetToken(token);
    const user = await prisma.user.findFirst({
      where: {
        resetToken: tokenHash,
        resetTokenExpiry: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset link. Please request a new one.' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(parsedPassword.data, 12);

    // Consume the token in the same statement that changes the password.
    // A concurrent reset, a newly issued token, or expiry during hashing
    // makes this update a no-op instead of overwriting the user's password.
    const { count } = await prisma.user.updateMany({
      where: {
        id: user.id,
        resetToken: tokenHash,
        resetTokenExpiry: { gt: new Date() },
      },
      data: {
        hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        // Invalidates any existing sessions (e.g. an attacker's, if that's why
        // the password was reset) — see the jwt callback in lib/auth.ts.
        tokenVersion: { increment: 1 },
      },
    });

    if (count !== 1) {
      return NextResponse.json({ error: 'Invalid or expired reset link. Please request a new one.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
