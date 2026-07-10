export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ success: true });
    }

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to user
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    // Build reset URL
    const baseUrl = process.env.NEXTAUTH_URL || 'https://countdowndo.com';
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Send email
    const appUrl = process.env.NEXTAUTH_URL || '';
    const appHostname = appUrl ? new URL(appUrl).hostname : 'countdowndo.com';

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 16px; overflow: hidden;">
        <div style="background: #e8760a; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">CountdownDo</h1>
        </div>
        <div style="padding: 32px 24px;">
          <h2 style="color: #f5f5f5; margin: 0 0 16px;">Reset Your Password</h2>
          <p style="color: #a0a0a0; line-height: 1.6; margin: 0 0 24px;">
            We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="background: #e8760a; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 13px; line-height: 1.5;">
            If you didn't request this, you can safely ignore this email. Your password will remain unchanged.
          </p>
          <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;" />
          <p style="color: #555; font-size: 12px; margin: 0;">
            If the button doesn't work, copy and paste this link:<br/>
            <a href="${resetUrl}" style="color: #e8760a; word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
      </div>
    `;

    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      const fromEmail = process.env.EMAIL_FROM || `CountdownDo <noreply@${appHostname}>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: user.email,
          subject: 'Reset your CountdownDo password',
          html: htmlBody,
        }),
      });
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
      return NextResponse.json({ error: 'Failed to send reset email. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
