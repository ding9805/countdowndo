import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { clearRateLimit, deleteRateLimitEntries, getClientIp, recordAttempt } from '@/lib/rate-limit';
import { SIGN_IN_WINDOW_MINUTES, TOO_MANY_SIGN_IN_ATTEMPTS } from '@/lib/auth-errors';

// Failed sign-ins allowed per window: per email, so one account can't be
// brute-forced from many IPs, and per IP (higher, since people can share
// one), so one IP can't spray guesses across many accounts.
const SIGN_IN_WINDOW_SECONDS = SIGN_IN_WINDOW_MINUTES * 60;
const MAX_FAILED_SIGN_INS_PER_EMAIL = 10;
const MAX_FAILED_SIGN_INS_PER_IP = 30;

// Checks a sign-in under the rate limit. Returns the user, null for wrong
// credentials (or any error), or 'rate-limited'.
async function verifySignIn(email: string, password: string, ip: string) {
  try {
    // Counted before the user lookup, unknown emails included, so a refusal
    // says nothing about whether an account exists — and a refused attempt
    // never costs a bcrypt hash.
    const attempts = await Promise.all([
      recordAttempt('sign-in:email', email, SIGN_IN_WINDOW_SECONDS, MAX_FAILED_SIGN_INS_PER_EMAIL),
      recordAttempt('sign-in:ip', ip, SIGN_IN_WINDOW_SECONDS, MAX_FAILED_SIGN_INS_PER_IP),
    ]);
    const attemptIds = attempts.map((attempt) => attempt.entryId);
    if (attempts.some((attempt) => attempt.limited)) {
      // Refused attempts don't count either, so retrying while blocked
      // doesn't push the block back.
      await deleteRateLimitEntries(attemptIds);
      return 'rate-limited' as const;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.hashedPassword);
    if (!isValid) return null;

    // Only failures count: take back this attempt and the email's earlier
    // failures, but not the IP's — otherwise signing in to any account would
    // reset the limit on guessing at all the others.
    await Promise.all([deleteRateLimitEntries(attemptIds), clearRateLimit('sign-in:email', email)]).catch((e) =>
      console.error('Sign-in rate-limit cleanup failed:', e)
    );
    return { id: user.id, email: user.email, name: user.name, tokenVersion: user.tokenVersion } as any;
  } catch (e) {
    console.error('Auth error:', e);
    return null;
  }
}

// How often to re-verify a session's tokenVersion against the DB. NextAuth's
// jwt callback runs on every getServerSession/useSession call (including the
// 3s active-session poll), so checking on every single call would add a DB
// round trip to nearly every request. A short cache window keeps that cost
// negligible while still invalidating a stolen session within ~1 minute of
// a password reset, instead of the JWT's full ~30-day lifetime.
const TOKEN_VERSION_CHECK_INTERVAL_MS = 60_000;

// The tokenVersion last read for each user (null: no such user), oldest read
// first. Kept in this server's memory rather than in the token: a route
// handler's getServerSession can't write the cookie back, so a time stamped
// in the token only moved on when the browser refetched its session, and
// every request more than a minute after that read the DB.
const tokenVersionReads = new Map<string, { tokenVersion: number | null; readAt: number }>();

// Whether a token's version matches the user's in the DB, as read within the
// last minute.
async function isTokenVersionCurrent(userId: string, tokenVersion: unknown): Promise<boolean> {
  const now = Date.now();
  let read = tokenVersionReads.get(userId);
  if (
    !read ||
    now - read.readAt > TOKEN_VERSION_CHECK_INTERVAL_MS ||
    // Versions only go up, so a token newer than the version read means it
    // has changed since: a password reset, then a sign-in with the new one.
    (typeof tokenVersion === 'number' && read.tokenVersion !== null && tokenVersion > read.tokenVersion)
  ) {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    read = { tokenVersion: dbUser?.tokenVersion ?? null, readAt: now };
    tokenVersionReads.delete(userId);
    tokenVersionReads.set(userId, read);
    // Forget users not read for a minute. Each read goes back in at the end,
    // so the oldest come first and this stops at the first recent one.
    for (const [id, { readAt }] of tokenVersionReads) {
      if (now - readAt <= TOKEN_VERSION_CHECK_INTERVAL_MS) break;
      tokenVersionReads.delete(id);
    }
  }
  return read.tokenVersion !== null && read.tokenVersion === tokenVersion;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const result = await verifySignIn(
          credentials.email.toLowerCase().trim(),
          credentials.password,
          getClientIp(req)
        );
        // Thrown rather than returned so next-auth hands the code back to
        // signIn() as `error`, where the login page can explain it.
        if (result === 'rate-limited') throw new Error(TOO_MANY_SIGN_IN_ATTEMPTS);
        return result;
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Sign-in: seed the token fresh from the just-verified DB row.
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.tokenVersion = (user as any).tokenVersion ?? 0;
        return token;
      }

      // Subsequent request: confirm this token's version still matches the
      // DB. A password reset increments tokenVersion, so a stale token (e.g.
      // an attacker's, if that's why the password was reset) gets flagged
      // here instead of staying valid for the JWT's full lifetime.
      if (token?.id && !(await isTokenVersionCurrent(token.id as string, token.tokenVersion))) {
        token.invalidated = true;
      }
      return token;
    },
    async session({ session, token }) {
      if ((token as any).invalidated) {
        // Strip the user so the app's existing `!session?.user` checks
        // (used everywhere, client and server) treat this as signed out.
        return { ...session, user: undefined } as any;
      }
      if (session.user) {
        (session.user as any).id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
};
