import { TIMER_CHIMES, type TimerChime } from '@/lib/use-timer-sound';

export const TIMER_SETTINGS_KEY = 'countdowndo-timer-settings';

export interface TimerSettings {
  alarmEnabled: boolean;
  chime: TimerChime;
  sessionVolume: number;
  volume: number;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  alarmEnabled: true,
  chime: 'double-beep',
  sessionVolume: 0.3,
  volume: 0.3,
};

function isTimerChime(value: unknown): value is TimerChime {
  return TIMER_CHIMES.some((chime) => chime.id === value);
}

export function readTimerSettings(): TimerSettings {
  if (typeof window === 'undefined') return DEFAULT_TIMER_SETTINGS;

  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_SETTINGS_KEY) || '{}');
    return {
      alarmEnabled: typeof saved.alarmEnabled === 'boolean' ? saved.alarmEnabled : DEFAULT_TIMER_SETTINGS.alarmEnabled,
      chime: isTimerChime(saved.chime) ? saved.chime : DEFAULT_TIMER_SETTINGS.chime,
      sessionVolume: typeof saved.sessionVolume === 'number'
        ? Math.min(1, Math.max(0, saved.sessionVolume))
        : DEFAULT_TIMER_SETTINGS.sessionVolume,
      volume: typeof saved.volume === 'number'
        ? Math.min(1, Math.max(0, saved.volume))
        : DEFAULT_TIMER_SETTINGS.volume,
    };
  } catch {
    return DEFAULT_TIMER_SETTINGS;
  }
}

export function writeTimerSettings(settings: TimerSettings) {
  try {
    localStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are optional when storage is unavailable.
  }
}
