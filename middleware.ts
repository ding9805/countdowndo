import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/api/task-bank/:path*',
    '/api/active-session/:path*',
    '/api/completion-log/:path*',
  ],
};
