import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

// How often to re-verify a session's tokenVersion against the DB. NextAuth's
// jwt callback runs on every getServerSession/useSession call (including the
// 3s active-session poll), so checking on every single call would add a DB
// round trip to nearly every request. A short cache window keeps that cost
// negligible while still invalidating a stolen session within ~1 minute of
// a password reset, instead of the JWT's full ~30-day lifetime.
const TOKEN_VERSION_CHECK_INTERVAL_MS = 60_000;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email.toLowerCase().trim() },
          });
          if (!user) return null;

          const isValid = await bcrypt.compare(credentials.password, user.hashedPassword);
          if (!isValid) return null;

          return { id: user.id, email: user.email, name: user.name, tokenVersion: user.tokenVersion } as any;
        } catch (e) {
          console.error('Auth error:', e);
          return null;
        }
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
        token.tokenVersionCheckedAt = Date.now();
        return token;
      }

      // Subsequent request: periodically confirm this token's version still
      // matches the DB. A password reset increments tokenVersion, so a stale
      // token (e.g. an attacker's, if that's why the password was reset)
      // gets flagged here instead of staying valid for the JWT's full lifetime.
      const lastChecked = (token.tokenVersionCheckedAt as number) ?? 0;
      if (token?.id && Date.now() - lastChecked > TOKEN_VERSION_CHECK_INTERVAL_MS) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { tokenVersion: true },
        });
        token.tokenVersionCheckedAt = Date.now();
        if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
          token.invalidated = true;
        }
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
