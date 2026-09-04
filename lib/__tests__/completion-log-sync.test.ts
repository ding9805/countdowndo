/**
 * Regression tests for the two completion-log bugs.
 *
 * 1. Un-marking a task raced its own log write. handleMarkDone marks the task
 *    done, POSTs the log entry, and stamps the returned id onto the task in a
 *    .then. Un-marking before that resolved saw completionLogId still null, so
 *    it skipped the retraction — the history kept an entry for work the user
 *    had taken back, the .then stamped an id onto a task that was no longer
 *    done, and marking it done again logged a second entry.
 *
 * 3. Guest history ids could repeat. A guest's rows are minted client-side as
 *    `local-${Date.now()}-${indexWithinTheCall}`; the index restarts at 0 on
 *    every call, so two calls in the same millisecond (or two tabs sharing the
 *    same localStorage) produced the same id. Removal matches by id and dropped
 *    every match, so retracting one completion took an unrelated one with it.
 *
 * 2. "Clear all" dropped completions past the batch cap. It sent every
 *    not-done task in one request; the server caps a batch at
 *    MAX_COMPLETION_LOG_BATCH while a session may hold five times that, so a
 *    long list was rejected wholesale and the completions vanished silently.
 */

import {
  MAX_COMPLETION_LOG_BATCH,
  PendingCompletionLogs,
  batchCompletionLogTasks,
  beginCompletionLogWrite,
  cancelCompletionLogWrite,
  nextLocalCompletionLogId,
  removeLocalCompletionLogEntry,
  settleCompletionLogWrite,
} from '../completion-log-sync';

describe('In-flight completion-log writes', () => {
  let pending: PendingCompletionLogs;
  beforeEach(() => {
    pending = new Map();
  });

  test('a write nobody touched attaches its id to the task', () => {
    const write = beginCompletionLogWrite(pending, 'task_1');
    expect(settleCompletionLogWrite(pending, 'task_1', write, 'log_1')).toBe('attach');
    expect(pending.size).toBe(0);
  });

  test('⚠ the bug: un-marking mid-flight retracts the row the write creates', () => {
    const write = beginCompletionLogWrite(pending, 'task_1');
    // User un-checks before the POST comes back. There is no id to retract at
    // this moment — that is exactly why the old code did nothing here.
    cancelCompletionLogWrite(pending, 'task_1');

    expect(settleCompletionLogWrite(pending, 'task_1', write, 'log_1')).toBe('retract');
    expect(pending.size).toBe(0);
  });

  test('a failed write leaves nothing to clean up', () => {
    const write = beginCompletionLogWrite(pending, 'task_1');
    expect(settleCompletionLogWrite(pending, 'task_1', write, undefined)).toBe('discard');
    expect(settleCompletionLogWrite(pending, 'task_1', write, null)).toBe('discard');
  });

  test('a failed write that was also cancelled has nothing to retract', () => {
    const write = beginCompletionLogWrite(pending, 'task_1');
    cancelCompletionLogWrite(pending, 'task_1');
    expect(settleCompletionLogWrite(pending, 'task_1', write, null)).toBe('discard');
  });

  test('done → undone → done leaves exactly one entry, whatever order they land in', () => {
    const first = beginCompletionLogWrite(pending, 'task_1');
    cancelCompletionLogWrite(pending, 'task_1');
    const second = beginCompletionLogWrite(pending, 'task_1');

    // The second cycle's write is live and must not be cancelled by the first.
    expect(settleCompletionLogWrite(pending, 'task_1', first, 'log_1')).toBe('retract');
    expect(settleCompletionLogWrite(pending, 'task_1', second, 'log_2')).toBe('attach');
  });

  test('the same pair settles correctly when the writes come back out of order', () => {
    const first = beginCompletionLogWrite(pending, 'task_1');
    cancelCompletionLogWrite(pending, 'task_1');
    const second = beginCompletionLogWrite(pending, 'task_1');

    expect(settleCompletionLogWrite(pending, 'task_1', second, 'log_2')).toBe('attach');
    expect(settleCompletionLogWrite(pending, 'task_1', first, 'log_1')).toBe('retract');
  });

  test('settling a superseded write does not free the live one', () => {
    const first = beginCompletionLogWrite(pending, 'task_1');
    cancelCompletionLogWrite(pending, 'task_1');
    const second = beginCompletionLogWrite(pending, 'task_1');

    settleCompletionLogWrite(pending, 'task_1', first, 'log_1');
    expect(pending.get('task_1')).toBe(second);
  });

  test('writes for different tasks are tracked independently', () => {
    const a = beginCompletionLogWrite(pending, 'task_a');
    const b = beginCompletionLogWrite(pending, 'task_b');
    cancelCompletionLogWrite(pending, 'task_b');

    expect(settleCompletionLogWrite(pending, 'task_a', a, 'log_a')).toBe('attach');
    expect(settleCompletionLogWrite(pending, 'task_b', b, 'log_b')).toBe('retract');
  });

  test('cancelling with nothing outstanding is a no-op', () => {
    expect(() => cancelCompletionLogWrite(pending, 'task_ghost')).not.toThrow();
    expect(pending.size).toBe(0);
  });
});

describe('batchCompletionLogTasks', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => i);

  test('⚠ the bug: a clear-all sized list no longer goes out as one oversized request', () => {
    // 500 is MAX_TASKS_PER_SESSION — the most a single "Clear all" can log.
    const batches = batchCompletionLogTasks(list(500));
    expect(batches).toHaveLength(5);
    expect(batches.every((batch) => batch.length <= MAX_COMPLETION_LOG_BATCH)).toBe(true);
  });

  test('every task lands in exactly one batch, in order', () => {
    const batches = batchCompletionLogTasks(list(250));
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(list(250));
  });

  test('a list that fits goes out as a single request', () => {
    expect(batchCompletionLogTasks(list(100))).toEqual([list(100)]);
    expect(batchCompletionLogTasks(list(1))).toEqual([[0]]);
  });

  test('an empty list produces no requests at all', () => {
    expect(batchCompletionLogTasks([])).toEqual([]);
  });

  test('a nonsensical batch size still makes progress instead of looping forever', () => {
    expect(batchCompletionLogTasks(list(3), 0)).toEqual([[0], [1], [2]]);
    expect(batchCompletionLogTasks(list(3), -5)).toEqual([[0], [1], [2]]);
    expect(batchCompletionLogTasks(list(3), 2.7)).toEqual([[0, 1], [2]]);
  });
});

describe('Batched writes still map each log row back to its task', () => {
  // Mirrors the idMap loop in logCompletedTasks: the server answers with one
  // row per entry in the batch, indexed batch-locally, while completedTasks is
  // the whole list — so the offset has to advance across batches.
  function collectIds(taskIds: string[], failingBatch = -1): Record<string, string> {
    const batches = batchCompletionLogTasks(taskIds, 2);
    const idMap: Record<string, string> = {};
    let offset = 0;
    batches.forEach((batch, batchIndex) => {
      if (batchIndex !== failingBatch) {
        batch.forEach((_, i) => {
          const taskId = taskIds[offset + i];
          if (taskId) idMap[taskId] = `log_for_${taskId}`;
        });
      }
      offset += batch.length;
    });
    return idMap;
  }

  test('ids line up across every batch', () => {
    expect(collectIds(['a', 'b', 'c', 'd', 'e'])).toEqual({
      a: 'log_for_a',
      b: 'log_for_b',
      c: 'log_for_c',
      d: 'log_for_d',
      e: 'log_for_e',
    });
  });

  test('a failed batch loses only its own tasks, and later batches stay aligned', () => {
    expect(collectIds(['a', 'b', 'c', 'd', 'e'], 1)).toEqual({
      a: 'log_for_a',
      b: 'log_for_b',
      e: 'log_for_e',
    });
  });
});

describe('Guest completion-log ids', () => {
  /** The scheme this replaced: index restarts at 0 on every call. */
  const legacyId = (now: number, indexWithinCall: number) => `local-${now}-${indexWithinCall}`;

  test('⚠ the bug: the old scheme repeats across calls in the same millisecond', () => {
    const frozen = 1_760_000_000_000;
    // Two separate logCompletedTasks calls, each logging its first task.
    expect(legacyId(frozen, 0)).toBe(legacyId(frozen, 0));
  });

  test('ids stay distinct even when the clock does not move', () => {
    const frozen = 1_760_000_000_000;
    const ids = Array.from({ length: 500 }, () => nextLocalCompletionLogId(frozen));
    expect(new Set(ids).size).toBe(500);
  });

  test('ids stay distinct across a moving clock', () => {
    const ids = Array.from({ length: 200 }, (_, i) => nextLocalCompletionLogId(1_760_000_000_000 + i));
    expect(new Set(ids).size).toBe(200);
  });

  test('ids keep the local- prefix and carry the timestamp', () => {
    const id = nextLocalCompletionLogId(1_760_000_000_000);
    expect(id.startsWith('local-1760000000000-')).toBe(true);
  });
});

describe('removeLocalCompletionLogEntry', () => {
  const entries = [
    { id: 'a', taskName: 'First' },
    { id: 'b', taskName: 'Second' },
    { id: 'c', taskName: 'Third' },
  ];

  test('removes the named entry and leaves the rest in order', () => {
    expect(removeLocalCompletionLogEntry(entries, 'b')).toEqual([
      { id: 'a', taskName: 'First' },
      { id: 'c', taskName: 'Third' },
    ]);
  });

  test('⚠ a legacy duplicate id costs one entry, not both', () => {
    // Rows already stored under the old scheme can share an id; a plain filter
    // would delete the unrelated completion too.
    const withDuplicate = [
      { id: 'dup', taskName: 'Kept' },
      { id: 'dup', taskName: 'Removed first' },
    ];
    const remaining = removeLocalCompletionLogEntry(withDuplicate, 'dup');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].taskName).toBe('Removed first');
  });

  test('an unknown id leaves the list untouched', () => {
    expect(removeLocalCompletionLogEntry(entries, 'missing')).toEqual(entries);
  });

  test('does not mutate the list it was given', () => {
    const original = [...entries];
    removeLocalCompletionLogEntry(entries, 'a');
    expect(entries).toEqual(original);
  });

  test('tolerates an empty list and malformed rows', () => {
    expect(removeLocalCompletionLogEntry([], 'a')).toEqual([]);
    const malformed = [{ taskName: 'No id' } as { id?: string; taskName: string }, { id: 'a', taskName: 'Fine' }];
    expect(removeLocalCompletionLogEntry(malformed, 'a')).toEqual([{ taskName: 'No id' }]);
  });
});
