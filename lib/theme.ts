export const THEME_MODE_STORAGE_KEY = 'countdowndo-theme-mode';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type AppliedTheme = 'light' | 'dark';

const DAY_START_HOUR = 7;
const NIGHT_START_HOUR = 19;

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark';
}

export function getAutomaticTheme(date = new Date()): AppliedTheme {
  const hour = date.getHours();
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'light' : 'dark';
}

export function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';

  const storedMode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (isThemeMode(storedMode)) return storedMode;

  // Preserve an explicit Light/Dark choice made before Auto mode existed.
  const legacyTheme = localStorage.getItem('theme');
  if (legacyTheme === 'light' || legacyTheme === 'dark') {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, legacyTheme);
    return legacyTheme;
  }

  localStorage.setItem(THEME_MODE_STORAGE_KEY, 'auto');
  return 'auto';
}
