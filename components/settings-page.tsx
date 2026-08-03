'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Moon, Settings as SettingsIcon, Sun, SunMoon, Timer } from 'lucide-react';
import { useTheme } from 'next-themes';
import { PageToggle } from './page-toggle';
import { ThemeToggle } from './theme-toggle';
import { TimerSoundSettings } from './timer-sound-settings';
import type { TimerChime } from '@/lib/use-timer-sound';
import { DEFAULT_TIMER_SETTINGS, readTimerSettings, writeTimerSettings } from '@/lib/timer-settings';
import { getAutomaticTheme, readThemeMode, THEME_MODE_STORAGE_KEY, type ThemeMode } from '@/lib/theme';
import { Label } from '@/components/ui/label';

const THEME_OPTIONS: { value: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
  { value: 'auto', label: 'Automatic', description: 'Light during the day and dark at night', icon: SunMoon },
  { value: 'light', label: 'Light', description: 'Use the light theme all the time', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Use the dark theme all the time', icon: Moon },
];

export function SettingsPage() {
  const { setTheme } = useTheme();
  const [timerSettings, setTimerSettings] = useState(DEFAULT_TIMER_SETTINGS);
  const [themeMode, setThemeMode] = useState<ThemeMode>('auto');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    setTimerSettings(readTimerSettings());
    setThemeMode(readThemeMode());
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (settingsLoaded) writeTimerSettings(timerSettings);
  }, [settingsLoaded, timerSettings]);

  const selectThemeMode = (mode: ThemeMode) => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    setThemeMode(mode);
    setTheme(mode === 'auto' ? getAutomaticTheme() : mode);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-2 flex-wrap">
          <Link href="/session" className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center glow-primary shrink-0">
              <Timer className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground">CountdownDo</span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
            <PageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 sm:py-14">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <SettingsIcon className="w-5 h-5 text-primary" />
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Settings</h1>
          </div>
          <p className="text-sm text-muted-foreground">Customize how CountdownDo looks and how your timer sounds.</p>
        </div>

        <div className="space-y-6">
          <section className="glass-card rounded-2xl p-5 sm:p-6" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="mb-5">
              <h2 className="font-display text-base font-semibold text-foreground">Timer sounds</h2>
              <p className="text-sm text-muted-foreground mt-1">Choose a short, gentle sound to play when a timer reaches zero.</p>
            </div>
            <TimerSoundSettings
              alarmEnabled={timerSettings.alarmEnabled}
              chime={timerSettings.chime}
              sessionVolume={timerSettings.sessionVolume}
              volume={timerSettings.volume}
              onAlarmEnabledChange={(alarmEnabled) => setTimerSettings((current) => ({ ...current, alarmEnabled }))}
              onChimeChange={(chime: TimerChime) => setTimerSettings((current) => ({ ...current, chime }))}
              onSessionVolumeChange={(sessionVolume) => setTimerSettings((current) => ({ ...current, sessionVolume }))}
              onVolumeChange={(volume) => setTimerSettings((current) => ({ ...current, volume }))}
            />
          </section>

          <section className="glass-card rounded-2xl p-5 sm:p-6" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="mb-5">
              <h2 className="font-display text-base font-semibold text-foreground">Appearance</h2>
              <p className="text-sm text-muted-foreground mt-1">Set a fixed theme or let the time of day choose for you.</p>
            </div>
            <div className="space-y-3" role="radiogroup" aria-label="Theme preference">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = settingsLoaded && themeMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => selectThemeMode(option.value)}
                    className={`w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                      selected ? 'border-primary/50 bg-primary/10' : 'border-border/50 bg-secondary/20 hover:bg-secondary/40'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${selected ? 'bg-primary/15 text-primary' : 'bg-secondary/60 text-muted-foreground'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Label className="block text-sm font-medium text-foreground cursor-pointer">{option.label}</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                    </div>
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${selected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                      {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
