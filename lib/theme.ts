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

// When the browser blocks site data (a privacy setting, some private modes),
// every localStorage call throws. These run on every page, so they mustn't
// take it down over a theme preference: reads come back empty and saves are
// skipped.
function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {}
}

export function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';

  const storedMode = readStoredValue(THEME_MODE_STORAGE_KEY);
  if (isThemeMode(storedMode)) return storedMode;

  // Preserve an explicit Light/Dark choice made before Auto mode existed.
  const legacyTheme = readStoredValue('theme');
  if (legacyTheme === 'light' || legacyTheme === 'dark') {
    writeThemeMode(legacyTheme);
    return legacyTheme;
  }

  writeThemeMode('auto');
  return 'auto';
}
