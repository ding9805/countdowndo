// Decides whether a cross-device sync poll's response may overwrite local
// session state. Pure so the race conditions around it can be unit tested.

export interface PollGuardInput {
  // writeSeqRef at the moment the poll's fetch was issued, and now. Every
  // local write bumps it synchronously, before its save debounce.
  writeSeqAtStart: number;
  writeSeqNow: number;
  // A debounced save is queued (local state not yet sent to the server).
  savePending: boolean;
  // A save request is in flight.
  saving: boolean;
  // updatedAt of the row this response carries, and of the last save this
  // client had acknowledged.
  responseUpdatedAt?: string | null;
  lastKnownUpdatedAt?: string | null;
}

// Local state is authoritative whenever a local write has started, is queued,
// or is in flight: a response issued around such a write predates it, so
// applying it would undo the change — e.g. resurrecting tasks after Clear all.
export function shouldApplyPolledSession(input: PollGuardInput): boolean {
  if (input.writeSeqNow !== input.writeSeqAtStart) return false;
  if (input.savePending || input.saving) return false;
  // A slow response can outlive the write that supersedes it, arriving after
  // the save landed. Its updatedAt is then older than what we last saved.
  if (input.responseUpdatedAt && input.lastKnownUpdatedAt) {
    const responseAt = new Date(input.responseUpdatedAt).getTime();
    const knownAt = new Date(input.lastKnownUpdatedAt).getTime();
    if (Number.isFinite(responseAt) && Number.isFinite(knownAt) && responseAt < knownAt) return false;
  }
  return true;
}

// The elapsed-seconds reading a client should adopt along with a session row
// (initial load, cross-device poll, 409 reconciliation). The tick only runs
// while the session is 'running', so a client that adopts a paused row without
// this reads 0 elapsed — every task at its full remaining time and the
// timeline's "now" marker at the very top — until the user resumes.
export interface RestoredSessionTiming {
  sessionState?: string | null;
  // Date.now() when the session was started or last resumed.
  sessionStartMs?: number | null;
  // Seconds elapsed before the last pause.
  pausedElapsed?: number | null;
}

export function restoredElapsedSeconds(
  row: RestoredSessionTiming,
  now: number = Date.now()
): number {
  const paused = Number.isFinite(row?.pausedElapsed as number) ? (row.pausedElapsed as number) : 0;

  if (row?.sessionState === 'paused') return Math.max(0, paused);

  if (row?.sessionState === 'running') {
    // Same formula as the timer tick, so adopting a running row lands on the
    // reading the next tick would have produced 200ms later anyway.
    const startMs = Number.isFinite(row?.sessionStartMs as number) ? (row.sessionStartMs as number) : now;
    return Math.max(0, Math.floor((now - startMs) / 1000) + paused);
  }

  return 0;
}

// Local writes that must not outlive the session they belong to. Ending a
// session deletes or rewrites its row, so a save queued (or in flight) just
// before that would land afterwards and recreate the row as 'running' — the
// stopped session comes back on the next load. Settle both before writing.
export interface PendingWrites {
  cancelQueuedSave: () => void;
  inFlightSave: Promise<unknown> | null;
}

export async function settlePendingWrites(writes: PendingWrites): Promise<void> {
  writes.cancelQueuedSave();
  // A failed save is still settled — we only care that it is no longer racing
  // the write that follows.
  if (writes.inFlightSave) await writes.inFlightSave.catch(() => {});
}
