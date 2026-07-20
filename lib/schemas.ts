import { z } from 'zod';
import { TASK_COLORS } from '@/lib/types';

// Shared validation for the state-bearing APIs (active-session, completion-log,
// task-bank). Centralized so every route enforces the same shape/bounds instead
// of each hand-rolling its own ad-hoc checks — and so a hostile or buggy client
// can't persist unbounded arrays or malformed rows that crash the UI on load.

const TASK_COLOR_IDS = TASK_COLORS.map((c) => c.id) as [string, ...string[]];
export const taskColorSchema = z.enum(TASK_COLOR_IDS);

const MAX_NAME_LENGTH = 200;
const MAX_TASKS_PER_SESSION = 500;
const MAX_SOUND_PLAYED = 500;
const MAX_COMPLETION_LOG_BATCH = 100;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_DURATION_SECONDS = 24 * 60 * 60; // 24h ceiling — generous, but not unbounded

const dueDateSchema = z.string().date();

const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const durationSchema = z.number().finite().positive().max(MAX_DURATION_SECONDS);
const tagsSchema = z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS);

// Mirrors the client-side Task interface in lib/types.ts.
export const taskSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(MAX_NAME_LENGTH), // not trimmed/min(1) here: an in-progress session task can be blank mid-edit
  durationSeconds: z.number().finite().nonnegative().max(MAX_DURATION_SECONDS),
  cumulativeSeconds: z.number().finite(),
  isDone: z.boolean(),
  doneAt: z.number().finite().nullable(),
  bonusSeconds: z.number().finite(),
  color: taskColorSchema,
  completionLogId: z.string().nullable().optional(),
  bankTaskId: z.string().nullable().optional(),
  isOneOffBankTask: z.boolean().optional(),
});

export const activeSessionPayloadSchema = z.object({
  tasks: z.array(taskSchema).max(MAX_TASKS_PER_SESSION).default([]),
  sessionState: z.enum(['idle', 'running', 'paused']).default('running'),
  sessionMode: z.literal('continuous').default('continuous'),
  sessionStartMs: z.number().finite().default(() => Date.now()),
  pausedElapsed: z.number().finite().default(0),
  sessionTotalSeconds: z.number().finite().default(0),
  soundPlayed: z.array(z.string()).max(MAX_SOUND_PLAYED).default([]),
  // The updatedAt (as an ISO string) of the row this client last saw. Lets the
  // server detect and reject a write that would silently clobber a change
  // made by another device/tab since — see the optimistic-concurrency check
  // in app/api/active-session/route.ts.
  lastKnownUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const completionLogEntrySchema = z.object({
  name: nameSchema,
  durationSeconds: durationSchema,
  completedAt: z.string().datetime({ offset: true }).optional(),
  color: taskColorSchema.optional(),
});

export const completionLogPayloadSchema = z.object({
  tasks: z.array(completionLogEntrySchema).min(1).max(MAX_COMPLETION_LOG_BATCH),
});

// Shared by BankTask and BankTaskTemplate — same shape on both create and update
// (fields optional on update, since PUT there only patches what's provided).
export const bankTaskCreateSchema = z.object({
  name: nameSchema,
  durationSeconds: durationSchema,
  color: taskColorSchema.optional(),
  tags: tagsSchema.optional(),
  isOneOff: z.boolean().optional().default(false),
  dueDate: dueDateSchema.nullable().optional(),
});

export const bankTaskUpdateSchema = z.object({
  name: nameSchema.optional(),
  durationSeconds: durationSchema.optional(),
  color: taskColorSchema.optional(),
  tags: tagsSchema.optional(),
  isOneOff: z.boolean().optional(),
  dueDate: dueDateSchema.nullable().optional(),
});

// Session-end sweep. Bounded by the session task cap (not the completion-log
// batch cap) since a session can complete up to that many bank tasks. An empty
// list is allowed: the sweep also restores stray soft-deleted rows, which is
// worth doing even when nothing was completed.
export const completeOneOffBankTasksSchema = z.object({
  bankTaskIds: z.array(z.string().min(1)).max(MAX_TASKS_PER_SESSION),
});

// Check-off/uncheck soft-delete toggle for one-off bank tasks mid-session.
export const checkOneOffBankTasksSchema = z.object({
  bankTaskIds: z.array(z.string().min(1)).min(1).max(MAX_TASKS_PER_SESSION),
  done: z.boolean(),
});

// Goals. Values are bounded so a hostile client can't store absurd numbers
// that break the derived interval math or the progress UI.
const MAX_UNIT_LENGTH = 30;
const goalValueSchema = z.number().finite().min(-1e9).max(1e9);
const goalIntervalsSchema = z.number().int().min(1).max(1000);

export const goalCreateSchema = z
  .object({
    name: nameSchema,
    unit: z.string().trim().min(1).max(MAX_UNIT_LENGTH),
    startValue: goalValueSchema,
    targetValue: goalValueSchema,
    intervals: goalIntervalsSchema,
    intervalSeconds: durationSchema,
    color: taskColorSchema.optional(),
    dueDate: dueDateSchema,
  })
  .refine((g) => g.targetValue > g.startValue, {
    message: 'Target must be greater than the starting value',
    path: ['targetValue'],
  });

export const goalUpdateSchema = z.object({
  name: nameSchema.optional(),
  unit: z.string().trim().min(1).max(MAX_UNIT_LENGTH).optional(),
  startValue: goalValueSchema.optional(),
  targetValue: goalValueSchema.optional(),
  currentValue: goalValueSchema.optional(),
  intervals: goalIntervalsSchema.optional(),
  intervalSeconds: durationSchema.optional(),
  color: taskColorSchema.optional(),
  dueDate: dueDateSchema.optional(),
});

// Session-engine step for a goal-linked bank task. Resolved server-side by the
// unique bankTaskId, so it's safe to call for any bank-linked task — non-goal
// tasks are a no-op (same trust model as check-one-offs).
export const goalStepSchema = z.object({
  bankTaskId: z.string().min(1),
  direction: z.enum(['advance', 'retreat']),
});

// Signup input. Caps lengths so arbitrarily large strings can't be stored
// verbatim (254 is the practical email max per RFC 5321; bcrypt only uses the
// first 72 bytes of the password anyway).
export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72),
  name: z.string().trim().max(100).optional().nullable(),
});

// Formats a ZodError into a single readable message for API error responses.
export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid request';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}
