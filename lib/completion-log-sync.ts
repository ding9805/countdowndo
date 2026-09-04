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
