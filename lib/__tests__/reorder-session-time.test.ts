/**
 * Tests for task reorder logic — verifying that shifting tasks up/down
 * never deducts from the overall session end time.
 *
 * We extract the pure logic from handleReorder (sequence-app.tsx) and
 * simulate the exact same calculation here so we can run deterministic
 * assertions without needing a full React render.
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

// ── helpers ──────────────────────────────────────────────────────────

/** Build a quick task with sensible defaults */
function t(id: string, durationSeconds: number, cumulativeSeconds: number, isDone = false): Task {
  return { id, name: `Task ${id}`, durationSeconds, cumulativeSeconds, isDone, doneAt: null, bonusSeconds: 0, color: 'orange' as const };
}

/** Total session time = last task's cumulativeSeconds */
function sessionTotal(tasks: Task[]): number {
  return tasks.length > 0 ? tasks[tasks.length - 1].cumulativeSeconds : 0;
}

/**
 * Mirrors the CONTINUOUS-mode branch of handleReorder exactly.
 * @param oldTasks – the tasks array BEFORE the reorder (read from state)
 * @param newTasks – the tasks array AFTER the move (from moveTask)
 */
function reorderContinuous(oldTasks: Task[], newTasks: Task[]): Task[] {
  const oldTotal = oldTasks.length > 0
    ? (oldTasks[oldTasks.length - 1]?.cumulativeSeconds ?? 0)
    : 0;
  const sumOfDurations = newTasks.reduce((sum, tk) => sum + (tk?.durationSeconds ?? 0), 0);
  const baseOffset = oldTotal - sumOfDurations;

  let cumulative = baseOffset;
  return newTasks.map((task) => {
    cumulative += task.durationSeconds;
    return { ...task, cumulativeSeconds: cumulative };
  });
}

/** Mirrors the SPRINT-mode branch (and idle branch) of handleReorder. */
function reorderSprint(newTasks: Task[]): Task[] {
  return recalculateCumulativeTimes(newTasks);
}

/** Simulates moveTask(fromIndex, toIndex) from active-session.tsx */
function moveTask(tasks: Task[], fromIndex: number, toIndex: number): Task[] {
  if (toIndex < 0 || toIndex >= tasks.length) return [...tasks];
  const copy = [...tasks];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

/** Simulates continuous-mode delete: just filter, no recalculation */
function deleteContinuous(tasks: Task[], taskId: string): Task[] {
  return tasks.filter((tk) => tk.id !== taskId);
}

/** Simulates continuous-mode edit: apply delta to edited + subsequent tasks */
function editContinuous(tasks: Task[], taskId: string, newDuration: number): Task[] {
  const idx = tasks.findIndex((tk) => tk.id === taskId);
  if (idx < 0) return tasks;
  const delta = newDuration - tasks[idx].durationSeconds;
  return tasks.map((tk, i) => {
    if (i === idx) return { ...tk, durationSeconds: newDuration, cumulativeSeconds: tk.cumulativeSeconds + delta };
    if (i > idx) return { ...tk, cumulativeSeconds: tk.cumulativeSeconds + delta };
    return tk;
  });
}

// ── Test 1: Continuous mode — basic reorder (no prior deletes) ──────
describe('Continuous mode reorder — no prior deletes', () => {
  const initial = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
  ];
  const expectedTotal = 1500;

  test('move B up (index 1→0) preserves total', () => {
    const moved = moveTask(initial, 1, 0);           // [B, A, C]
    const result = reorderContinuous(initial, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('move A down (index 0→1) preserves total', () => {
    const moved = moveTask(initial, 0, 1);           // [B, A, C]
    const result = reorderContinuous(initial, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('move C up (index 2→1) preserves total', () => {
    const moved = moveTask(initial, 2, 1);           // [A, C, B]
    const result = reorderContinuous(initial, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('move C to top (index 2→0) preserves total', () => {
    const moved = moveTask(initial, 2, 0);           // [C, A, B]
    const result = reorderContinuous(initial, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });
});

// ── Test 2: Continuous mode — reorder AFTER deleting a middle task ───
describe('Continuous mode reorder — after deleting middle task', () => {
  // Start: A(600,600) B(300,900) C(600,1500)
  // Delete B → A(600,600) C(600,1500)   total still 1500
  const afterDelete = deleteContinuous(
    [t('A', 600, 600), t('B', 300, 900), t('C', 600, 1500)],
    'B',
  );
  const expectedTotal = 1500;

  test('after delete, total is still 1500', () => {
    expect(sessionTotal(afterDelete)).toBe(expectedTotal);
  });

  test('swap A↔C preserves total', () => {
    const moved = moveTask(afterDelete, 1, 0);        // [C, A]
    const result = reorderContinuous(afterDelete, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('swap back C↔A preserves total (second consecutive reorder)', () => {
    const firstMove = moveTask(afterDelete, 1, 0);
    const afterFirst = reorderContinuous(afterDelete, firstMove);
    // now [C, A] — move A up
    const secondMove = moveTask(afterFirst, 1, 0);    // [A, C]
    const result = reorderContinuous(afterFirst, secondMove);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });
});

// ── Test 3: Continuous mode — reorder AFTER deleting the FIRST task ──
describe('Continuous mode reorder — after deleting first task', () => {
  const initial = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
  ];
  // Delete A → B(300,900) C(600,1500)   total = 1500
  const afterDelete = deleteContinuous(initial, 'A');
  const expectedTotal = 1500;

  test('move C up preserves total', () => {
    const moved = moveTask(afterDelete, 1, 0);        // [C, B]
    const result = reorderContinuous(afterDelete, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });
});

// ── Test 4: Continuous mode — reorder AFTER deleting the LAST task ───
describe('Continuous mode reorder — after deleting last task', () => {
  const initial = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
  ];
  // Delete C → A(600,600) B(300,900)
  // ⚠ Expected: total should stay 1500 to preserve session length
  //    Actual:  total drops to 900 because last task's cumulative = 900
  const afterDelete = deleteContinuous(initial, 'C');

  test('after deleting last task, total drops (BUG DETECTION)', () => {
    // This test documents the fact that continuous delete of the LAST task
    // loses that task's time window because no subsequent task remembers it.
    const dropped = sessionTotal(afterDelete); // 900, not 1500
    expect(dropped).toBe(900); // current behaviour
    // Uncomment the next line to assert the DESIRED behaviour:
    // expect(dropped).toBe(1500);
  });

  test('reorder after deleting last task preserves (already-reduced) total', () => {
    const moved = moveTask(afterDelete, 1, 0);        // [B, A]
    const result = reorderContinuous(afterDelete, moved);
    expect(sessionTotal(result)).toBe(sessionTotal(afterDelete)); // 900
  });
});

// ── Test 5: Continuous mode — reorder AFTER editing a task duration ──
describe('Continuous mode reorder — after editing duration', () => {
  const initial = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
  ];
  // Edit B from 300→600: delta = +300
  // A(600,600) B(600,1200) C(600,1800)   total = 1800
  const afterEdit = editContinuous(initial, 'B', 600);
  const expectedTotal = 1800;

  test('edit increases total correctly', () => {
    expect(sessionTotal(afterEdit)).toBe(expectedTotal);
  });

  test('move B up after edit preserves total', () => {
    const moved = moveTask(afterEdit, 1, 0);           // [B, A, C]
    const result = reorderContinuous(afterEdit, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('move C up after edit preserves total', () => {
    const moved = moveTask(afterEdit, 2, 0);           // [C, A, B]
    const result = reorderContinuous(afterEdit, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });
});

// ── Test 6: Continuous mode — edit + delete + reorder combo ─────────
describe('Continuous mode reorder — edit, then delete, then reorder', () => {
  const initial = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
    t('D', 300, 1800),
  ];
  // Edit B 300→600: A(600,600) B(600,1200) C(600,1800) D(300,2100)
  const afterEdit = editContinuous(initial, 'B', 600);
  // Delete C: A(600,600) B(600,1200) D(300,2100)
  const afterDelete = deleteContinuous(afterEdit, 'C');
  const expectedTotal = 2100;

  test('total after edit+delete is preserved', () => {
    expect(sessionTotal(afterDelete)).toBe(expectedTotal);
  });

  test('move D up preserves total', () => {
    const moved = moveTask(afterDelete, 2, 0);         // [D, A, B]
    const result = reorderContinuous(afterDelete, moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('three consecutive reorders preserve total', () => {
    let current = afterDelete;
    // Move D up
    let moved = moveTask(current, 2, 0);
    current = reorderContinuous(current, moved);
    expect(sessionTotal(current)).toBe(expectedTotal);

    // Move B (now idx 2) up
    moved = moveTask(current, 2, 1);
    current = reorderContinuous(current, moved);
    expect(sessionTotal(current)).toBe(expectedTotal);

    // Move A (idx 2) to top
    moved = moveTask(current, 2, 0);
    current = reorderContinuous(current, moved);
    expect(sessionTotal(current)).toBe(expectedTotal);
  });
});

// ── Test 7: Sprint mode — reorder always recalculates cleanly ───────
describe('Sprint mode reorder — total = sum of durations', () => {
  const initial = recalculateCumulativeTimes([
    t('A', 600, 0),
    t('B', 300, 0),
    t('C', 600, 0),
  ]);
  const expectedTotal = 1500;

  test('move B up preserves total', () => {
    const moved = moveTask(initial, 1, 0);
    const result = reorderSprint(moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });

  test('move C to top preserves total', () => {
    const moved = moveTask(initial, 2, 0);
    const result = reorderSprint(moved);
    expect(sessionTotal(result)).toBe(expectedTotal);
  });
});

// ── Test 8: Continuous mode — stale-closure simulation ──────────────
// This simulates the scenario where `tasks` (from the React closure)
// lags behind the actual state because a prior setTasks hasn't
// re-rendered yet. handleReorder reads `tasks` from the closure (old)
// while moveTask builds newTasks from props (also old). This test
// verifies they produce consistent results even when both are stale.
describe('Continuous mode — stale closure simulation', () => {
  // "true" state after a recent delete that hasn't re-rendered:
  const staleState = [
    t('A', 600, 600),
    t('B', 300, 900),
    t('C', 600, 1500),
  ];
  // The delete of B happened via setTasks callback, so it won't be
  // reflected in `tasks` until the next render. Both moveTask and
  // handleReorder still see the stale 3-task list.

  test('reorder on stale state is still internally consistent', () => {
    const moved = moveTask(staleState, 2, 0);          // [C, A, B]
    const result = reorderContinuous(staleState, moved);
    // The total should match the stale state's total (1500), not the
    // post-delete state. This is correct — the next render will
    // reconcile. The question is whether the numbers are self-consistent.
    expect(sessionTotal(result)).toBe(sessionTotal(staleState));
    // Also verify each task's cumulative is monotonically increasing
    for (let i = 1; i < result.length; i++) {
      expect(result[i].cumulativeSeconds).toBeGreaterThan(result[i - 1].cumulativeSeconds);
    }
  });
});
