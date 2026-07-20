import { prisma } from '@/lib/db';
import { cursorTaskName, clampGoalValue, intervalSize, isGoalComplete } from '@/lib/goal-utils';
import type { Goal, Prisma } from '@prisma/client';

// Server-side goal stepping and cursor-task sync. All mutations run inside a
// transaction so the goal row and its cursor BankTask never drift apart.

type Tx = Prisma.TransactionClient;

// Creates the cursor BankTask for a goal and links it. Caller must ensure the
// goal is incomplete and currently has no cursor.
async function createCursorTask(tx: Tx, goal: Goal): Promise<Goal> {
  const task = await tx.bankTask.create({
    data: {
      userId: goal.userId,
      name: cursorTaskName(goal),
      durationSeconds: goal.intervalSeconds,
      color: goal.color,
      tags: goal.tags,
      isOneOff: false,
      dueDate: goal.dueDate,
    },
  });
  return tx.goal.update({
    where: { id: goal.id },
    data: { bankTaskId: task.id, lastBankTaskId: task.id },
  });
}

// Advance (+1) or retreat (-1) a goal by one interval, keeping the cursor
// task's name in sync — deleting it on completion, recreating it on undo.
export async function stepGoal(tx: Tx, goal: Goal, direction: 1 | -1): Promise<Goal> {
  const step = intervalSize(goal) * direction;
  const currentValue = clampGoalValue(goal.currentValue + step, goal);
  const nowComplete = isGoalComplete({ currentValue, targetValue: goal.targetValue });

  let updated = await tx.goal.update({
    where: { id: goal.id },
    data: { currentValue, completedAt: nowComplete ? (goal.completedAt ?? new Date()) : null },
  });

  // A retreat past completion must bring the cursor task back to life.
  return syncCursorTask(tx, updated, { forceCreate: direction === -1 });
}

// Makes the cursor task reflect the goal's current state: renamed to the next
// chunk while incomplete, deleted when complete, recreated if missing (e.g.
// after an undo past completion, or a manual edit that un-completes a goal).
// Does NOT resurrect a cursor the user deleted from the bank on a mere rename —
// only creates one when `forceCreate` is set (regenerate/un-complete paths).
export async function syncCursorTask(tx: Tx, goal: Goal, opts?: { forceCreate?: boolean }): Promise<Goal> {
  const complete = isGoalComplete(goal);

  if (complete) {
    if (goal.bankTaskId) {
      await tx.bankTask.deleteMany({ where: { id: goal.bankTaskId, userId: goal.userId } });
      goal = await tx.goal.update({ where: { id: goal.id }, data: { bankTaskId: null } });
    }
    return goal;
  }

  if (goal.bankTaskId) {
    await tx.bankTask.updateMany({
      where: { id: goal.bankTaskId, userId: goal.userId },
      data: {
        name: cursorTaskName(goal),
        durationSeconds: goal.intervalSeconds,
        color: goal.color,
        tags: goal.tags,
        dueDate: goal.dueDate,
      },
    });
    return goal;
  }

  if (opts?.forceCreate) {
    return createCursorTask(tx, goal);
  }
  return goal;
}

export { createCursorTask };
