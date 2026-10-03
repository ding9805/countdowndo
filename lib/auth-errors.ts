// Shared by lib/auth.ts and the login page. next-auth hands an error thrown in
// `authorize` back to signIn() as `result.error`, so the page can explain it.
export const TOO_MANY_SIGN_IN_ATTEMPTS = 'TooManySignInAttempts';

// Length of the sign-in rate limit's sliding window.
export const SIGN_IN_WINDOW_MINUTES = 15;
