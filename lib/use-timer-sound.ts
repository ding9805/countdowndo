'use client';

export type TimerChime = 'double-beep' | 'bell' | 'digital' | 'soft-pulse';

export const TIMER_CHIMES: { id: TimerChime; label: string }[] = [
  { id: 'double-beep', label: 'Double beep' },
  { id: 'bell', label: 'Bell' },
  { id: 'digital', label: 'Digital' },
  { id: 'soft-pulse', label: 'Soft pulse' },
];

interface Tone {
  frequency: number;
  start: number;
  duration: number;
  type: OscillatorType;
}

const CHIME_TONES: Record<TimerChime, Tone[]> = {
  'double-beep': [
    { frequency: 880, start: 0, duration: 0.22, type: 'sine' },
    { frequency: 1100, start: 0.3, duration: 0.22, type: 'sine' },
  ],
  bell: [
    { frequency: 660, start: 0, duration: 0.8, type: 'triangle' },
    { frequency: 990, start: 0.03, duration: 0.55, type: 'sine' },
  ],
  digital: [
    { frequency: 1200, start: 0, duration: 0.1, type: 'square' },
    { frequency: 1200, start: 0.16, duration: 0.1, type: 'square' },
    { frequency: 1600, start: 0.32, duration: 0.22, type: 'square' },
  ],
  'soft-pulse': [
    { frequency: 440, start: 0, duration: 0.65, type: 'sine' },
    { frequency: 660, start: 0.18, duration: 0.7, type: 'sine' },
  ],
};

export function playTimerSound({ chime = 'double-beep', volume = 0.3 }: { chime?: TimerChime; volume?: number } = {}) {
  try {
    if (volume <= 0) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = audioCtx.currentTime;
    const gain = Math.min(1, Math.max(0, volume));

    for (const tone of CHIME_TONES[chime]) {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      const start = now + tone.start;
      const end = start + tone.duration;

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      oscillator.type = tone.type;
      gainNode.gain.setValueAtTime(Math.max(0.001, gain * 0.3), start);
      gainNode.gain.exponentialRampToValueAtTime(0.01, end);
      oscillator.start(start);
      oscillator.stop(end);
    }
  } catch (e: any) {
    console.error('Audio playback failed:', e);
  }
}
