/**
 * Regression tests for restoring the elapsed counter alongside a session row.
 *
 * applyRemoteSessionData used to restore sessionState/sessionStartMs/
 * pausedElapsed but not elapsedSeconds. The timer tick only runs while a
 * session is 'running', so a client adopting a *paused* row (a refresh, a
 * second device, a 409 reconciliation) was left with elapsedSeconds at its
 * initial 0: a session paused 25 minutes in came back reading 00:00, with
 * every task at full remaining time and the timeline's "now" marker at the
 * very top, until the user hit Resume.
 */

import { restoredElapsedSeconds } from '../session-sync';

const NOW = 1_760_000_000_000;

describe('restoredElapsedSeconds', () => {
  test('a paused row restores the elapsed time it was paused at', () => {
    const row = { sessionState: 'paused', sessionStartMs: null, pausedElapsed: 1500 };
    expect(restoredElapsedSeconds(row, NOW)).toBe(1500);
  });

  test('a paused row that was never resumed still reads its pausedElapsed', () => {
    // sessionStartMs lingers from before the pause; it must not be used.
    const row = { sessionState: 'paused', sessionStartMs: NOW - 9_999_000, pausedElapsed: 42 };
    expect(restoredElapsedSeconds(row, NOW)).toBe(42);
  });

  test('a running row is projected forward from sessionStartMs', () => {
    // Same formula as the tick: floor((now - start) / 1000) + pausedElapsed.
    const row = { sessionState: 'running', sessionStartMs: NOW - 61_400, pausedElapsed: 0 };
    expect(restoredElapsedSeconds(row, NOW)).toBe(61);
  });

  test('a running row resumed after a pause adds the time banked before it', () => {
    const row = { sessionState: 'running', sessionStartMs: NOW - 30_000, pausedElapsed: 600 };
    expect(restoredElapsedSeconds(row, NOW)).toBe(630);
  });

  test('an idle (staged) row has no elapsed time', () => {
    expect(restoredElapsedSeconds({ sessionState: 'idle', sessionStartMs: NOW, pausedElapsed: 900 }, NOW)).toBe(0);
  });

  test('never returns a negative reading from a clock skewed ahead of the row', () => {
    // Another device's clock can be ahead of this one, putting sessionStartMs
    // in the future. A negative elapsed would run every countdown backwards.
    const row = { sessionState: 'running', sessionStartMs: NOW + 120_000, pausedElapsed: 0 };
    expect(restoredElapsedSeconds(row, NOW)).toBe(0);
  });

  test('tolerates missing/garbage timing fields', () => {
    expect(restoredElapsedSeconds({ sessionState: 'paused' }, NOW)).toBe(0);
    expect(restoredElapsedSeconds({ sessionState: 'paused', pausedElapsed: null }, NOW)).toBe(0);
    // No sessionStartMs on a running row falls back to "just started".
    expect(restoredElapsedSeconds({ sessionState: 'running', pausedElapsed: 10 }, NOW)).toBe(10);
    expect(restoredElapsedSeconds({}, NOW)).toBe(0);
  });
});
