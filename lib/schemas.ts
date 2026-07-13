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
  sessionMode: z.enum(['continuous', 'sprint']).default('continuous'),
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
  completedAt: z.string().datetime({ offset: true }).optional().or(z.string().optional()),
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
});

export const bankTaskUpdateSchema = z.object({
  name: nameSchema.optional(),
  durationSeconds: durationSchema.optional(),
  color: taskColorSchema.optional(),
  tags: tagsSchema.optional(),
  isOneOff: z.boolean().optional(),
});

// Formats a ZodError into a single readable message for API error responses.
export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid request';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}
