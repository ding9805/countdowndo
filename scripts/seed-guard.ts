// Whether a database URL points at this machine. The seed's test account has
// a password anyone can read in this repo, so it may only be created in a
// local database. NODE_ENV can't tell: .env points at the production
// database, so running the seed in development would still write there.
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');
}
