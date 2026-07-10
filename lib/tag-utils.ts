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
