const DEFAULT_DURATIONS = [300, 1800, 7200];

export function formatPresetDuration(seconds: number): string {
  const parts = [
    [Math.floor(seconds / 3600), 'h'],
    [Math.floor((seconds % 3600) / 60), 'm'],
    [seconds % 60, 's'],
  ] as const;
  return parts.filter(([value]) => value > 0).map(([value, unit]) => `${value}${unit}`).join(' ');
}

/** Prefer the most common bank durations; break frequency ties shortest first. */
export function getDurationPresets(tasks: ReadonlyArray<{ durationSeconds: number }>): number[] {
  const counts = new Map<number, number>();
  for (const { durationSeconds } of tasks) {
    if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 12 * 3600) continue;
    if (DEFAULT_DURATIONS.includes(durationSeconds)) continue;
    counts.set(durationSeconds, (counts.get(durationSeconds) ?? 0) + 1);
  }
  const personal = [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => bCount - aCount || a - b)
    .slice(0, 2)
    .map(([seconds]) => seconds);
  return [...DEFAULT_DURATIONS, ...personal].sort((a, b) => a - b);
}
