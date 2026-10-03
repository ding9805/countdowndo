// What Google Analytics gets to see of a page's address. Kept out of the
// component so these rules can be tested.

// Pages whose URL carries a secret (the password-reset link's token).
// Analytics is neither loaded on them nor told about them.
const UNTRACKED_PATHS = ['/reset-password'];

export function isTrackedPath(pathname: string): boolean {
  return !UNTRACKED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// Page fields for a gtag 'config' call. Only the path is reported: a query
// string can carry tokens and other values that don't belong in analytics,
// and without an explicit page_location gtag sends the full address.
export function analyticsPageFields(location: Pick<Location, 'origin' | 'pathname'>) {
  return { page_path: location.pathname, page_location: location.origin + location.pathname };
}
