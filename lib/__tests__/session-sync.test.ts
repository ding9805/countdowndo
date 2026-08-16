import { shouldApplyPolledSession } from '../session-sync';

const base = {
  writeSeqAtStart: 4,
  writeSeqNow: 4,
  savePending: false,
  saving: false,
  responseUpdatedAt: '2026-08-16T10:00:05.000Z',
  lastKnownUpdatedAt: '2026-08-16T10:00:05.000Z',
};

describe('shouldApplyPolledSession', () => {
  test('applies a quiet poll with no local writes around it', () => {
    expect(shouldApplyPolledSession(base)).toBe(true);
  });

  test('applies a response newer than our last save (another device wrote)', () => {
    expect(shouldApplyPolledSession({ ...base, responseUpdatedAt: '2026-08-16T10:00:09.000Z' })).toBe(true);
  });

  test('drops a response when a local write started mid-flight', () => {
    // Clear all fires while the poll's fetch is outstanding.
    expect(shouldApplyPolledSession({ ...base, writeSeqNow: 5 })).toBe(false);
  });

  test('drops a response while a debounced save is still queued', () => {
    // Clear all already ran; its save has not been sent yet, so the server
    // response still carries the pre-clear task list.
    expect(shouldApplyPolledSession({ ...base, savePending: true })).toBe(false);
  });

  test('drops a response while a save is in flight', () => {
    expect(shouldApplyPolledSession({ ...base, saving: true })).toBe(false);
  });

  test('drops a slow response that predates our last acknowledged save', () => {
    // Poll issued after the clear, but so slow that it landed after the
    // clear's save — its payload is the pre-clear row.
    expect(shouldApplyPolledSession({
      ...base,
      responseUpdatedAt: '2026-08-16T10:00:01.000Z',
      lastKnownUpdatedAt: '2026-08-16T10:00:05.000Z',
    })).toBe(false);
  });

  test('applies when timestamps are missing (nothing to compare against)', () => {
    expect(shouldApplyPolledSession({ ...base, responseUpdatedAt: null, lastKnownUpdatedAt: null })).toBe(true);
  });
});
