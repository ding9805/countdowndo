import { prisma } from '@/lib/db';

// All tag-bearing models for a user — BankTask, BankTaskTemplate, Goal.
// Goals are included so a goal tag reuses the casing of an existing bank-task
// tag (and vice versa) instead of forking "Grocery" / "grocery". The exclude
// options drop the row being edited from the corpus so its own current tags
// don't pin the casing on a rename (e.g. "Grocery" → "grocery" on the only
// row using the tag would otherwise round-trip back to "Grocery").
export interface TagCorpusOptions {
  excludeBankTaskId?: string;
  excludeTemplateId?: string;
  excludeGoalId?: string;
}

export async function getUserTagCorpus(userId: string, opts: TagCorpusOptions = {}): Promise<string[]> {
  const [tasks, templates, goals] = await Promise.all([
    prisma.bankTask.findMany({
      where: { userId, ...(opts.excludeBankTaskId ? { id: { not: opts.excludeBankTaskId } } : {}) },
      select: { tags: true },
    }),
    prisma.bankTaskTemplate.findMany({
      where: { userId, ...(opts.excludeTemplateId ? { id: { not: opts.excludeTemplateId } } : {}) },
      select: { tags: true },
    }),
    prisma.goal.findMany({
      where: { userId, ...(opts.excludeGoalId ? { id: { not: opts.excludeGoalId } } : {}) },
      select: { tags: true },
    }),
  ]);
  return [...tasks, ...templates, ...goals].flatMap((t) => t.tags);
}

// Normalizes incoming tags against a user's existing tag corpus: trims
// whitespace, drops empties, dedupes case-insensitively (keeping the first
// casing seen), and reuses existing casing when a case-insensitive match is
// found so "grocery" reuses "Grocery" instead of creating a near-duplicate.
export function normalizeTags(existingTags: string[], incoming: string[]): string[] {
  const existingByLower = new Map<string, string>();
  for (const tag of existingTags) {
    const lower = tag.toLowerCase();
    if (!existingByLower.has(lower)) existingByLower.set(lower, tag);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of incoming) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(existingByLower.get(lower) ?? trimmed);
  }
  return result;
}
