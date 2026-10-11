import { getDurationPresets, formatPresetDuration } from '../duration-presets';

const bank = (...durations: number[]) => durations.map((durationSeconds) => ({ durationSeconds }));

test('empty bank keeps the three defaults in ascending order', () => {
  expect(getDurationPresets([])).toEqual([300, 1800, 7200]);
});

test('frequent defaults do not use up either personalized suggestion', () => {
  expect(getDurationPresets(bank(300, 300, 1800, 7200, 900, 900, 3600, 3600, 600)))
    .toEqual([300, 900, 1800, 3600, 7200]);
});

test('ties prefer shorter durations regardless of bank ordering', () => {
  expect(getDurationPresets(bank(3600, 900, 120))).toEqual([120, 300, 900, 1800, 7200]);
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
