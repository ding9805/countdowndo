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
