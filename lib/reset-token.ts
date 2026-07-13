import crypto from 'crypto';

// Password reset tokens are emailed to the user in plaintext (that's the
// point — it's the secret they prove possession of), but only the hash is
// ever stored in the database. Anyone with DB read access (a leak, a backup,
// a log line) can't use a stored value to take over an account.
export function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
