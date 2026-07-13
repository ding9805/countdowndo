export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

const RATE_LIMIT_SECONDS = 300; // 5 minutes between submissions per IP
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 2000;
const VALID_CATEGORIES = ['bug', 'feature', 'general'];

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + (process.env.NEXTAUTH_SECRET || 'salt')).digest('hex');
}

// feedback.message/email are attacker-controlled free text that gets
// interpolated into an HTML email sent to the site owner's inbox — without
// escaping, a submitter can inject markup (phishing links styled as app UI,
// tracking pixels, layout takeover) into that email.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, message, email, website } = body ?? {};

    // Honeypot check — 'website' field is hidden, bots fill it in
    if (website) {
      // Silently accept to not tip off bots
      return NextResponse.json({ success: true });
    }

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Please select a valid category' }, { status: 400 });
    }

    // Validate message
    const trimmedMessage = (message ?? '').trim();
    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Feedback must be at least ${MIN_MESSAGE_LENGTH} characters` }, { status: 400 });
    }
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Feedback must be under ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 });
    }

    // Validate optional email
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    // Rate limiting by hashed IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
    const ipHash = hashIp(ip);

    const recentFeedback = await prisma.feedback.findFirst({
      where: {
        ipHash,
        createdAt: { gte: new Date(Date.now() - RATE_LIMIT_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentFeedback) {
      const waitSeconds = Math.ceil(
        (RATE_LIMIT_SECONDS * 1000 - (Date.now() - recentFeedback.createdAt.getTime())) / 1000
      );
      const waitMinutes = Math.ceil(waitSeconds / 60);
      return NextResponse.json(
        { error: `Please wait ${waitMinutes} minute${waitMinutes > 1 ? 's' : ''} before submitting again` },
        { status: 429 }
      );
    }

    // Store feedback
    const feedback = await prisma.feedback.create({
      data: {
        category,
        message: trimmedMessage,
        email: email?.trim() || null,
        ipHash,
      },
    });

    // Send email notification (non-blocking)
    sendFeedbackEmail(feedback).catch((e) => console.error('Failed to send feedback email:', e));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/feedback error:', error);
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
  }
}

async function sendFeedbackEmail(feedback: { id: string; category: string; message: string; email: string | null; createdAt: Date }) {
  const categoryLabels: Record<string, string> = {
    bug: '🐛 Bug Report',
    feature: '✨ Feature Request',
    general: '💬 General Feedback',
  };

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #f97316; border-bottom: 2px solid #f97316; padding-bottom: 10px;">
        ${categoryLabels[feedback.category] || 'Feedback'}
      </h2>
      <div style="background: #1a1a1a; color: #e5e5e5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 10px 0;"><strong style="color: #f97316;">Category:</strong> ${categoryLabels[feedback.category]}</p>
        ${feedback.email ? `<p style="margin: 10px 0;"><strong style="color: #f97316;">Reply-to:</strong> <a href="mailto:${encodeURIComponent(feedback.email)}" style="color: #60a5fa;">${escapeHtml(feedback.email)}</a></p>` : ''}
        <p style="margin: 10px 0;"><strong style="color: #f97316;">Message:</strong></p>
        <div style="background: #262626; padding: 15px; border-radius: 4px; border-left: 4px solid #f97316; white-space: pre-wrap;">
          ${escapeHtml(feedback.message)}
        </div>
      </div>
      <p style="color: #888; font-size: 12px;">
        Submitted at: ${feedback.createdAt.toLocaleString()} · ID: ${feedback.id}
      </p>
    </div>
  `;

  const appUrl = process.env.NEXTAUTH_URL || '';
  let appName = 'CountdownDo';
  let hostname = 'countdowndo.com';
  try {
    hostname = new URL(appUrl).hostname;
    appName = hostname.split('.')[0] || 'CountdownDo';
  } catch (e) {}

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || `${appName} <noreply@${hostname}>`;
  const feedbackRecipient = process.env.FEEDBACK_NOTIFICATION_EMAIL || 'zhongxinsamuel@gmail.com';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: feedbackRecipient,
      subject: `[CountdownDo] ${categoryLabels[feedback.category] || 'Feedback'} received`,
      html: htmlBody,
    }),
  });
  // fetch doesn't reject on 4xx/5xx — surface Resend rejections in the logs
  // (this call is already fire-and-forget, so there's nothing else to do
  // with it, but a silent failure here means notifications quietly stop).
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('Resend rejected feedback notification:', res.status, errBody);
  }
}
