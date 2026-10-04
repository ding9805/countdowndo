/**
 * Regression tests for keeping the seed's test account out of shared
 * databases.
 *
 * scripts/seed.ts creates an account whose password is in this repo, and
 * nothing stopped it running against the database in .env, which is
 * production. It now refuses unless DATABASE_URL points at this machine.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { isLocalDatabaseUrl } from '../../scripts/seed-guard';

describe('which databases the seed may write to', () => {
  test.each([
    'postgresql://postgres@localhost:5432/countdowndo',
    'postgresql://postgres@127.0.0.1:54329/e2e?schema=public',
    'postgresql://postgres@[::1]:5432/countdowndo',
    'postgresql://postgres@db.localhost/countdowndo',
    'postgresql://postgres@LOCALHOST/countdowndo',
  ])('a database on this machine: %s', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  test.each([
    'postgresql://user:pass@ep-example-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    'postgresql://user:pass@localhost.example.com/db',
    'postgresql://user:pass@10.0.0.5:5432/db',
    'not a url',
    '',
    undefined,
  ])('anywhere else, or no URL at all: %s', (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });

  test('the seed script refuses a remote database before connecting to it', () => {
    const root = path.resolve(__dirname, '../..');
    const result = spawnSync(path.join(root, 'node_modules/.bin/tsx'), ['scripts/seed.ts'], {
      cwd: root,
      // .invalid never resolves, so even a seed that tried couldn't reach anything.
      env: { ...process.env, DATABASE_URL: 'postgresql://user:pass@db.example.invalid:5432/app' },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Seed aborted');
  }, 30_000);
});
