import { getDurationPresets, formatPresetDuration } from '../duration-presets';

const bank = (...durations: number[]) => durations.map((durationSeconds) => ({ durationSeconds }));

test('empty bank keeps the three defaults in ascending order', () => {
  expect(getDurationPresets([])).toEqual([300, 1800, 7200]);
});

test('frequent defaults do not use up personalized suggestions', () => {
  expect(getDurationPresets(bank(300, 300, 1800, 7200, 900, 900, 3600, 3600, 600)))
    .toEqual([300, 600, 900, 1800, 3600, 7200]);
});

test('ties prefer shorter durations regardless of bank ordering', () => {
  expect(getDurationPresets(bank(3600, 900, 120, 60, 180, 240, 600, 1200, 2400)))
    .toEqual([60, 120, 180, 240, 300, 600, 900, 1200, 1800, 7200]);
});

test('only offers available unique durations and ignores invalid picker values', () => {
  expect(getDurationPresets(bank(600, 600, 0, -1, NaN, Infinity, 1.5, 999999)))
    .toEqual([300, 600, 1800, 7200]);
});

test('labels distinguish presets that differ only in seconds', () => {
  expect(formatPresetDuration(300)).toBe('5m');
  expect(formatPresetDuration(305)).toBe('5m 5s');
  expect(formatPresetDuration(7200)).toBe('2h');
});

test('caps suggestions at ten and ranks personal durations by frequency before sorting', () => {
  const result = getDurationPresets(bank(60, 120, 180, 240, 360, 420, 480, 540, 600, 600, 600));
  expect(result).toEqual([60, 120, 180, 240, 300, 360, 420, 600, 1800, 7200]);
  expect(new Set(result).size).toBe(10);
});
