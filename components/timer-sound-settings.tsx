'use client';

import React from 'react';
import { Bell, Volume2, VolumeX } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TIMER_CHIMES, TimerChime, playTimerSound } from '@/lib/use-timer-sound';

interface TimerSoundSettingsProps {
  alarmEnabled: boolean;
  chime: TimerChime;
  sessionVolume: number;
  volume: number;
  onAlarmEnabledChange: (enabled: boolean) => void;
  onChimeChange: (chime: TimerChime) => void;
  onSessionVolumeChange: (volume: number) => void;
  onVolumeChange: (volume: number) => void;
}

export function TimerSoundSettings({
  alarmEnabled,
  chime,
  sessionVolume,
  volume,
  onAlarmEnabledChange,
  onChimeChange,
  onSessionVolumeChange,
  onVolumeChange,
}: TimerSoundSettingsProps) {
  return (
    <div className="glass-card rounded-2xl p-4 space-y-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <div>
            <Label htmlFor="alarm-enabled" className="text-sm text-foreground">Timer alarm</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Play a chime when each timer ends</p>
          </div>
        </div>
        <Switch
          id="alarm-enabled"
          checked={alarmEnabled}
          onCheckedChange={onAlarmEnabledChange}
          aria-label="Enable timer alarm"
        />
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end ${!alarmEnabled ? 'opacity-50' : ''}`}>
        <div className="space-y-1.5">
          <Label htmlFor="timer-chime" className="text-xs text-muted-foreground">Chime sound</Label>
          <select
            id="timer-chime"
            value={chime}
            disabled={!alarmEnabled}
            onChange={(event) => onChimeChange(event.target.value as TimerChime)}
            className="w-full text-sm px-3 py-2 rounded-lg bg-secondary/60 border border-border/50 text-foreground focus:outline-none focus:border-primary/50 disabled:cursor-not-allowed"
          >
            {Array.from(new Set(TIMER_CHIMES.map((option) => option.category))).map((category) => (
              <optgroup key={category} label={category}>
                {TIMER_CHIMES.filter((option) => option.category === category).map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!alarmEnabled}
          onClick={() => playTimerSound({ chime, volume })}
          className="text-xs px-3 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          Test sound
        </button>
      </div>

      <div className={`space-y-1.5 ${!alarmEnabled ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between">
          <Label htmlFor="session-volume" className="text-xs text-muted-foreground flex items-center gap-1.5">
            {sessionVolume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            Session volume
          </Label>
          <span className="text-xs text-muted-foreground">{Math.round(sessionVolume * 100)}%</span>
        </div>
        <input
          id="session-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={sessionVolume}
          disabled={!alarmEnabled}
          onChange={(event) => onSessionVolumeChange(Number(event.target.value))}
          className="w-full accent-primary disabled:cursor-not-allowed"
        />
        <p className="text-[11px] text-muted-foreground">Used for chimes during an active session.</p>
      </div>

      <div className={`space-y-1.5 ${!alarmEnabled ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between">
          <Label htmlFor="timer-volume" className="text-xs text-muted-foreground flex items-center gap-1.5">
            {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            Sound volume
          </Label>
          <span className="text-xs text-muted-foreground">{Math.round(volume * 100)}%</span>
        </div>
        <input
          id="timer-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          disabled={!alarmEnabled}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          className="w-full accent-primary disabled:cursor-not-allowed"
        />
        <p className="text-[11px] text-muted-foreground">Used by the Test sound button.</p>
      </div>
    </div>
  );
}
