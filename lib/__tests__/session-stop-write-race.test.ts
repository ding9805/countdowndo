/**
 * Regression tests for ending a session, covering two bugs in handleStop.
 *
 * 1. Stop raced its own pending writes. saveSessionToDb is debounced by a
 *    second, so a change made just before Stop (mark done, edit, delete a
 *    task) POSTed *after* the DELETE. The server's optimistic-concurrency
 *    check finds no row, so it upserts a fresh one carrying sessionState
 *    'running' and the pre-stop task list — the stopped session comes back on
 *    the next page load.
 *
 * 2. Stop dropped the tasks it deliberately keeps. It filtered the done tasks
 *    out and left the rest staged in local state, but deleted the row without
 *    saving them. Every other mutation path persists the staged idle list so
 *    it survives a refresh; this one didn't.
 *
 * The fix settles the pending writes first (settlePendingWrites), then either
 * deletes the row or rewrites it as the staged idle list.
 */

import { settlePendingWrites } from '../session-sync';
import { resetTasksForNextSession, sessionTotalFor } from '../timer-utils';
import { Task } from '../types';

/** Drains everything already queued, so "nothing has happened yet" is a real claim. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function t(id: string, durationSeconds: number, cumulativeSeconds: number, isDone = false): Task {
  return {
    id,
    name: `Task ${id}`,
    durationSeconds,
    cumulativeSeconds,
    isDone,
    doneAt: isDone ? 1_700_000_000_000 : null,
    bonusSeconds: 0,
    color: 'orange',
  };
}

interface Row {
  tasks: Task[];
  sessionState: 'idle' | 'running' | 'paused';
  sessionTotalSeconds: number;
}

/** Stands in for the ActiveSession row and the two routes that write it. */
function makeServer() {
  let row: Row | null = null;
  const calls: string[] = [];
  // Lets a test hold one write open, so a save can be in flight (not merely
  // queued) at the moment Stop is pressed. Only the write that takes the gate
  // is held — anything issued afterwards runs straight through, so a Stop that
  // fails to wait for the save really can overtake it.
  let gate: Promise<void> = Promise.resolve();
  const takeGate = async () => {
    const held = gate;
    gate = Promise.resolve();
    await held;
  };

  return {
    calls,
    get row() {
      return row;
    },
    holdNextWrite(until: Promise<void>) {
      gate = until;
    },
    async post(payload: Row) {
      await takeGate();
      calls.push(`POST ${payload.sessionState}`);
      row = { ...payload };
    },
    async del() {
      await takeGate();
      calls.push('DELETE');
      row = null;
    },
  };
}

/**
 * Mirrors the engine's write path: a debounced save whose in-flight promise is
 * tracked, and a session-end write that either settles those pending writes
 * first (the fix) or doesn't (the old behaviour).
 */
function makeClient(server: ReturnType<typeof makeServer>, opts: { settleFirst: boolean }) {
  let queued: (() => Promise<void>) | null = null;
  let inFlight: Promise<unknown> | null = null;

  return {
    /** saveSessionToDb — arms the 1s debounce. */
    saveSessionToDb(payload: Row) {
      queued = () => server.post(payload);
    },
    /** The debounce timer firing. */
    fireDebounce(): Promise<unknown> {
      if (!queued) return Promise.resolve();
      const run = queued();
      queued = null;
      inFlight = run;
      return run;
    },
    /** endSessionInDb. */
    async endSession(remaining: Task[], remainingTotal: number) {
      if (opts.settleFirst) {
        await settlePendingWrites({
          cancelQueuedSave: () => {
            queued = null;
          },
          inFlightSave: inFlight,
        });
        inFlight = null;
      }
      if (remaining.length === 0) {
        await server.del();
        return;
      }
      await server.post({ tasks: remaining, sessionState: 'idle', sessionTotalSeconds: remainingTotal });
    },
  };
}

const running: Row = {
  tasks: [t('A', 600, 600, true), t('B', 300, 900)],
  sessionState: 'running',
  sessionTotalSeconds: 900,
};

describe('Stopping a session settles its pending writes first', () => {
  test('⚠ old behaviour: a debounced save that outlives Stop resurrects the session', async () => {
    const server = makeServer();
    const client = makeClient(server, { settleFirst: false });
    server.post(running); // session already saved as running

    // User marks a task done, then hits Stop inside the 1s debounce window.
    client.saveSessionToDb(running);
    await client.endSession([], 0);
    expect(server.row).toBeNull();

    // The debounce fires after the DELETE has landed.
    await client.fireDebounce();

    expect(server.row?.sessionState).toBe('running');
    expect(server.calls).toEqual(['POST running', 'DELETE', 'POST running']);
  });

  test('a save queued just before Stop is cancelled, and the session stays stopped', async () => {
    const server = makeServer();
    const client = makeClient(server, { settleFirst: true });
    server.post(running);

    client.saveSessionToDb(running);
    await client.endSession([], 0);

    // The timer still fires; there is simply nothing left queued to send.
    await client.fireDebounce();

    expect(server.row).toBeNull();
    expect(server.calls).toEqual(['POST running', 'DELETE']);
  });

  test('⚠ old behaviour: a save in flight at Stop lands after the delete and resurrects the session', async () => {
    const server = makeServer();
    const client = makeClient(server, { settleFirst: false });

    let release!: () => void;
    server.holdNextWrite(new Promise<void>((resolve) => { release = resolve; }));

    client.saveSessionToDb(running);
    const save = client.fireDebounce(); // in flight, blocked on the gate

    // Stop doesn't wait for it, so the DELETE goes out while the save is
    // still outstanding and the POST lands on an already-deleted row.
    const stopped = client.endSession([], 0);
    await settle();
    expect(server.calls).toEqual(['DELETE']);

    release();
    await Promise.all([save, stopped]);

    expect(server.row?.sessionState).toBe('running');
    expect(server.calls).toEqual(['DELETE', 'POST running']);
  });

  test('a save already in flight at Stop is waited out, so the delete lands last', async () => {
    const server = makeServer();
    const client = makeClient(server, { settleFirst: true });

    let release!: () => void;
    server.holdNextWrite(new Promise<void>((resolve) => { release = resolve; }));

    client.saveSessionToDb(running);
    const save = client.fireDebounce(); // in flight, blocked on the gate

    const stopped = client.endSession([], 0);
    await settle();
    // Still waiting on the save: the row must not have been touched yet.
    expect(server.calls).toEqual([]);

    release();
    await Promise.all([save, stopped]);

    expect(server.row).toBeNull();
    expect(server.calls).toEqual(['POST running', 'DELETE']);
  });

  test('a save that fails mid-flight still lets the session end', async () => {
    const failed = Promise.reject(new Error('network'));
    let cancelled = false;

    await expect(
      settlePendingWrites({ cancelQueuedSave: () => { cancelled = true; }, inFlightSave: failed })
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });
});

describe('Stopping a session persists the tasks it keeps staged', () => {
  test('unfinished tasks are written back as an idle list, not dropped', async () => {
    const server = makeServer();
    const client = makeClient(server, { settleFirst: true });
    server.post(running);

    const remaining = resetTasksForNextSession(running.tasks);
    await client.endSession(remaining, sessionTotalFor(remaining));

    // B survives on its own, re-anchored at zero; the row is staged, not gone.
    expect(server.row).not.toBeNull();
    expect(server.row?.sessionState).toBe('idle');
    expect(server.row?.tasks.map((task) => task.id)).toEqual(['B']);
    expect(server.row?.sessionTotalSeconds).toBe(300);
  });

  test('a session with nothing left over deletes its row instead', async () => {
    const server = makeServer();
    const client = makeClient(server, { settleFirst: true });
    server.post(running);

    const allDone = [t('A', 600, 600, true), t('B', 300, 900, true)];
    const remaining = resetTasksForNextSession(allDone);
    await client.endSession(remaining, sessionTotalFor(remaining));

    expect(remaining).toEqual([]);
    expect(server.row).toBeNull();
  });
});

describe('resetTasksForNextSession', () => {
  test('keeps only unfinished tasks and re-anchors their cumulative times', () => {
    const staged = resetTasksForNextSession([
      t('A', 600, 600, true),
      t('B', 300, 900),
      t('C', 120, 1020, true),
      t('D', 480, 1500),
    ]);

    expect(staged.map((task) => task.id)).toEqual(['B', 'D']);
    expect(staged.map((task) => task.cumulativeSeconds)).toEqual([300, 780]);
    expect(sessionTotalFor(staged)).toBe(780);
  });

  test('clears the per-run state that must not carry into the next session', () => {
    const carried = { ...t('B', 300, 900), bonusSeconds: 45, completionLogId: 'log_1' } as Task;
    const [staged] = resetTasksForNextSession([carried]);

    expect(staged.isDone).toBe(false);
    expect(staged.doneAt).toBeNull();
    expect(staged.bonusSeconds).toBe(0);
    expect(staged.completionLogId).toBeNull();
  });

  test('keeps the bank link so a carried-over task still resolves its goal', () => {
    const linked = { ...t('B', 300, 900), bankTaskId: 'bank_1', isOneOffBankTask: true } as Task;
    const [staged] = resetTasksForNextSession([linked]);

    expect(staged.bankTaskId).toBe('bank_1');
    expect(staged.isOneOffBankTask).toBe(true);
  });

  test('an empty or all-done list stages nothing', () => {
    expect(resetTasksForNextSession([])).toEqual([]);
    expect(resetTasksForNextSession([t('A', 600, 600, true)])).toEqual([]);
    expect(sessionTotalFor([])).toBe(0);
  });
});
