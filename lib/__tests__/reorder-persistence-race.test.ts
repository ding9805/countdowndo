/**
 * Test 2: Persistence race-condition simulation
 *
 * The pure reorder math is correct (Test 1 proves this). However,
 * handleReorder has a subtle React-state interaction:
 *
 *   handleReorder does:
 *     setTasks(updated);              // direct set (NOT callback)
 *     saveSessionToDb(updated);       // debounced (1 000 ms)
 *
 * Meanwhile, other parts of the component also call saveSessionToDb:
 *   - The sound-trigger useEffect calls saveSessionToDb() with NO args
 *     every time elapsedSeconds or tasks change.
 *   - saveSessionToDb is debounced: a new call CANCELS the previous one.
 *   - When called with no args, saveSessionToDb reads `tasks` from the
 *     closure captured in useCallback.
 *
 * Race scenario:
 *   1. User clicks "move up" → handleReorder queues save (debounce 1 s)
 *   2. Within 1 s, timer tick fires (every 200 ms) → sound-trigger
 *      effect may call saveSessionToDb() → CANCELS the queued save
 *      from step 1 and queues its OWN save.
 *   3. The new save reads `tasks` from the useCallback closure.
 *      If React has already committed the new tasks (from setTasks(updated)),
 *      the closure is fresh → save is correct. ✓
 *      If for any reason the closure is stale (e.g. the useCallback
 *      dependency array hasn't updated yet), the save writes OLD tasks to
 *      the DB → the next sync poll (3 s) loads old tasks → session total
 *      appears to shrink. ✗
 *
 * This test simulates the second (stale) path to see its impact.
 */

import { recalculateCumulativeTimes } from '../timer-utils';

interface Task {
  id: string;
  name: string;
  durationSeconds: number;
  cumulativeSeconds: number;
  isDone: boolean;
  doneAt: number | null;
  bonusSeconds: number;
  color: 'orange' | 'blue' | 'green' | 'purple' | 'pink';
}

function t(id: string, dur: number, cum: number): Task {
  return { id, name: `Task ${id}`, durationSeconds: dur, cumulativeSeconds: cum, isDone: false, doneAt: null, bonusSeconds: 0, color: 'orange' as const };
}

function sessionTotal(tasks: Task[]): number {
  return tasks.length > 0 ? tasks[tasks.length - 1].cumulativeSeconds : 0;
}

function reorderContinuous(oldTasks: Task[], newTasks: Task[]): Task[] {
  const oldTotal = oldTasks.length > 0 ? oldTasks[oldTasks.length - 1].cumulativeSeconds : 0;
  const sumDur = newTasks.reduce((s, tk) => s + tk.durationSeconds, 0);
  let cum = oldTotal - sumDur;
  return newTasks.map((tk) => { cum += tk.durationSeconds; return { ...tk, cumulativeSeconds: cum }; });
}

function moveTask(tasks: Task[], from: number, to: number): Task[] {
  const copy = [...tasks];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

function deleteContinuous(tasks: Task[], id: string): Task[] {
  return tasks.filter((tk) => tk.id !== id);
}

// ── Simulate the race ────────────────────────────────────────────
describe('Persistence race: stale save after reorder', () => {
  // Initial continuous session with one deleted task (gap of 300 s)
  const preDelete = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
  ];
  const afterDelete = deleteContinuous(preDelete, 'B'); // [A(600,600), C(600,1500)]

  test('reorder is correct locally', () => {
    const moved = moveTask(afterDelete, 1, 0);           // [C, A]
    const result = reorderContinuous(afterDelete, moved);
    expect(sessionTotal(result)).toBe(1500);
  });

  test('if stale (pre-reorder) tasks are persisted and reloaded, total stays the same', () => {
    // This simulates: reorder happened locally, but saveSessionToDb
    // was cancelled by the sound-trigger effect which saved the
    // PRE-reorder tasks (afterDelete) instead. Then sync poll loads them.
    const staleReloaded = afterDelete; // [A(600,600), C(600,1500)]
    // Total is still 1500 — the stale data preserves the gap.
    expect(sessionTotal(staleReloaded)).toBe(1500);
    // ✓ In this scenario the total does NOT change.
    // The user would lose the REORDER, not the session time.
  });

  test('⚠ BUT: if stale data goes through SPRINT recalculation on reload, total SHRINKS', () => {
    // This is the critical test.
    // If the sync poll reloads tasks and ANY code path recalculates
    // them from scratch (sprint-style), gaps collapse.
    const staleReloaded = afterDelete; // [A(600,600), C(600,1500)]
    const recalculated = recalculateCumulativeTimes(staleReloaded);
    // recalculateCumulativeTimes ignores existing cumulativeSeconds
    // and sums only durationSeconds: 600 + 600 = 1200
    expect(sessionTotal(recalculated)).toBe(1200);
    // ✗ Total dropped from 1500 → 1200 — THIS IS THE BUG PATH.
  });
});

// ── The smoking gun: handleStartSession recalculates ─────────────
describe('handleStartSession recalculates and collapses gaps', () => {
  test('recalculateCumulativeTimes destroys continuous-mode gaps', () => {
    // Tasks with a gap (B was deleted, leaving 300 s gap)
    const withGap = [t('A', 600, 600), t('C', 600, 1500)];
    expect(sessionTotal(withGap)).toBe(1500);

    // recalculateCumulativeTimes = what sprint-mode reorder does
    const collapsed = recalculateCumulativeTimes(withGap);
    expect(sessionTotal(collapsed)).toBe(1200); // gap lost
  });

  test('loading a saved list mid-session recalculates (potential gap loss)', () => {
    // handleLoadList calls recalculateCumulativeTimes on the loaded tasks.
    // If the user is in continuous mode with gaps, loading a list and then
    // the tasks being recalculated means gaps are erased.
    const withGap = [t('X', 300, 300), t('Y', 600, 1200)]; // 300s gap
    const loaded = recalculateCumulativeTimes(withGap);
    expect(sessionTotal(loaded)).toBe(900); // was 1200, now 900
  });
});

// ── Cross-device sync collision ──────────────────────────────────
describe('Cross-device sync: pollActiveSession overwrites local state', () => {
  test('sync loading pre-reorder tasks reverses a local reorder', () => {
    const beforeReorder = [t('A', 600, 600), t('C', 600, 1500)]; // gap from deleted B
    const moved = moveTask(beforeReorder, 1, 0);
    const afterReorder = reorderContinuous(beforeReorder, moved);
    expect(sessionTotal(afterReorder)).toBe(1500);

    // Sync poll returns the server state (which is still pre-reorder
    // because the debounced save was cancelled)
    const syncLoaded = beforeReorder;
    // Session total is still 1500, but the order reverts.
    // The user sees tasks jump back — confusing but no time loss.
    expect(sessionTotal(syncLoaded)).toBe(1500);
  });
});
