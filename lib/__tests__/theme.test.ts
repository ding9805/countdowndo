import { getAutomaticTheme, isThemeMode } from '../theme';

describe('getAutomaticTheme', () => {
  test('uses light mode during local daytime', () => {
    expect(getAutomaticTheme(new Date(2026, 6, 15, 7, 0))).toBe('light');
    expect(getAutomaticTheme(new Date(2026, 6, 15, 18, 59))).toBe('light');
  });

  test('uses dark mode overnight', () => {
    expect(getAutomaticTheme(new Date(2026, 6, 15, 6, 59))).toBe('dark');
    expect(getAutomaticTheme(new Date(2026, 6, 15, 19, 0))).toBe('dark');
  });
});

describe('isThemeMode', () => {
  test('accepts supported modes only', () => {
    expect(isThemeMode('auto')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('system')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});
