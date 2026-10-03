/**
 * Also regression tests for reading and saving the theme mode when the
 * browser blocks site data: every localStorage call then throws, and since
 * the theme is read on every page, that blanked the whole app.
 */

import { getAutomaticTheme, isThemeMode, readThemeMode, writeThemeMode } from '../theme';

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

describe('the stored theme mode', () => {
  const browserError = (name: string) => Object.assign(new Error(name), { name });

  function useStorage(storage: PropertyDescriptor) {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { ...storage, configurable: true });
  }

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  test('reads as Auto, and saving does nothing, when site data is blocked', () => {
    useStorage({ get: () => { throw browserError('SecurityError'); } });

    expect(readThemeMode()).toBe('auto');
    expect(() => writeThemeMode('dark')).not.toThrow();
  });

  test('a Light or Dark choice from before Auto mode still applies when saving fails', () => {
    useStorage({
      value: {
        getItem: (key: string) => (key === 'theme' ? 'light' : null),
        setItem: () => { throw browserError('QuotaExceededError'); },
      },
    });

    expect(readThemeMode()).toBe('light');
  });
});
