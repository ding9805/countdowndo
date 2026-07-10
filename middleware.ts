import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/api/saved-lists/:path*',
    '/api/active-session/:path*',
    '/api/completion-log/:path*',
  ],
};
