// Client-side bookkeeping for completion-log writes. Pure, so the races
// around them can be unit tested: the log row is created by a network call
// that can still be in flight when the user changes their mind, and it can
// outgrow what a single request is allowed to carry.

// How many completion-log entries one request may carry. Enforced server-side
// too — lib/schemas.ts imports this so the two can't drift. A session holds
// far more tasks than this (MAX_TASKS_PER_SESSION), so callers logging a whole
// list at once must batch it.
export const MAX_COMPLETION_LOG_BATCH = 100;

/**
 * Splits a list of completions into requests the server will accept. Returns
 * an empty array for an empty list — there is nothing to send.
 */
export function batchCompletionLogTasks<T>(tasks: T[], size = MAX_COMPLETION_LOG_BATCH): T[][] {
  const list = tasks ?? [];
  const batchSize = Math.max(1, Math.floor(size));
  const batches: T[][] = [];
  for (let i = 0; i < list.length; i += batchSize) {
    batches.push(list.slice(i, i + batchSize));
  }
  return batches;
}

// A log write that has been sent but not yet come back. Held per task id so
// un-marking that task while its write is outstanding can flag it: the id to
// retract doesn't exist yet at that moment, so the write has to clean up
// after itself when it lands.
export interface CompletionLogWrite {
  cancelled: boolean;
}

export type PendingCompletionLogs = Map<string, CompletionLogWrite>;

export type CompletionLogWriteOutcome =
  // Remember the new row's id on the task, so a later un-mark can retract it.
  | 'attach'
  // The task was un-marked while this write was in flight — delete the row it
  // just created, or the history keeps an entry for work the user took back
  // (and re-marking the task done would log a second one).
  | 'retract'
  // Nothing was created (the write failed); there is nothing to clean up.
  | 'discard';

export function beginCompletionLogWrite(
  pending: PendingCompletionLogs,
  taskId: string
): CompletionLogWrite {
  const write: CompletionLogWrite = { cancelled: false };
  pending.set(taskId, write);
  return write;
}

/** No-op when nothing is outstanding for the task — the common case. */
export function cancelCompletionLogWrite(pending: PendingCompletionLogs, taskId: string): void {
  const write = pending.get(taskId);
  if (write) write.cancelled = true;
}

/**
 * What to do with a write that has come back. `write` is the entry captured
 * when it was sent, so a write superseded by a later mark-done cycle still
 * settles against its own state rather than the newer one.
 */
export function settleCompletionLogWrite(
  pending: PendingCompletionLogs,
  taskId: string,
  write: CompletionLogWrite,
  logId?: string | null
): CompletionLogWriteOutcome {
  // Only clear the slot if it still belongs to this write; a newer cycle owns
  // it otherwise and must be left to settle on its own terms.
  if (pending.get(taskId) === write) pending.delete(taskId);
  if (!logId) return 'discard';
  return write.cancelled ? 'retract' : 'attach';
}

// Guests keep their history in localStorage, so the client has to mint the row
// ids the server would otherwise supply. The old scheme was
// `local-${Date.now()}-${indexWithinTheCall}`, which repeats as soon as two
// separate calls land in the same millisecond — the index restarts at 0 each
// time — and two tabs sharing this localStorage can collide the same way.
// Duplicate ids matter because removing an entry matches by id: retracting one
// completion would take an unrelated one with it.
//
// A monotonic counter keeps ids distinct within a page session, the timestamp
// keeps them distinct across reloads, and the random suffix covers two tabs
// writing in the same millisecond.
let localCompletionLogSequence = 0;

export function nextLocalCompletionLogId(now: number = Date.now()): string {
  localCompletionLogSequence += 1;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `local-${now}-${localCompletionLogSequence}-${suffix}`;
}

/**
 * Removes one stored completion by id, leaving any duplicate behind.
 *
 * Ids minted before the fix above can already repeat in a guest's stored
 * history, and a plain filter drops every match — so retracting one completion
 * silently deletes the other. Taking a single entry keeps the damage from a
 * legacy duplicate to the row the user actually acted on.
 */
export function removeLocalCompletionLogEntry<T extends { id?: string }>(entries: T[], id: string): T[] {
  const list = entries ?? [];
  const index = list.findIndex((entry) => entry?.id === id);
  if (index < 0) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)];
}
