'use client';

export type TimerChime =
  | 'double-beep'
  | 'bell'
  | 'digital'
  | 'soft-pulse'
  | 'bird-chirp'
  | 'mouth-click'
  | 'finger-snap'
  | 'lightning-crackle'
  | 'robotic-confirm'
  | 'robotic-scan'
  | 'mechanical-tick'
  | 'piano-tune'
  | 'violin-tune'
  | 'triangle-tune';

export const TIMER_CHIMES: { id: TimerChime; label: string; category: string }[] = [
  { id: 'double-beep', label: 'Double beep', category: 'Classic' },
  { id: 'bell', label: 'Bell', category: 'Classic' },
  { id: 'digital', label: 'Digital', category: 'Classic' },
  { id: 'soft-pulse', label: 'Soft pulse', category: 'Classic' },
  { id: 'bird-chirp', label: 'Bird chirp', category: 'Nature' },
  { id: 'mouth-click', label: 'Mouth clicks', category: 'Nature' },
  { id: 'finger-snap', label: 'Soft finger snap', category: 'Nature' },
  { id: 'lightning-crackle', label: 'Lightning crackle', category: 'Nature' },
  { id: 'robotic-confirm', label: 'Robot confirm', category: 'Robotic' },
  { id: 'robotic-scan', label: 'Robot scan', category: 'Robotic' },
  { id: 'mechanical-tick', label: 'Mechanical tick', category: 'Robotic' },
  { id: 'piano-tune', label: 'Piano tune', category: 'Instruments' },
  { id: 'violin-tune', label: 'Violin tune', category: 'Instruments' },
  { id: 'triangle-tune', label: 'Triangle tune', category: 'Instruments' },
];

interface Tone {
  frequency: number;
  start: number;
  duration: number;
  type: OscillatorType;
  volume?: number;
  endFrequency?: number;
  filterFrequency?: number;
}

type SoundScheduler = (audioContext: AudioContext, output: GainNode, now: number) => number;

const CLASSIC_TONES: Record<'double-beep' | 'bell' | 'digital' | 'soft-pulse', Tone[]> = {
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

function scheduleTone(audioContext: AudioContext, output: GainNode, now: number, tone: Tone) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const start = now + tone.start;
  const end = start + tone.duration;
  const attack = Math.min(0.025, tone.duration / 3);
  const peak = Math.max(0.001, tone.volume ?? 0.3);

  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  if (tone.endFrequency) oscillator.frequency.linearRampToValueAtTime(tone.endFrequency, end);

  if (tone.filterFrequency) {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(tone.filterFrequency, start);
    oscillator.connect(filter);
    filter.connect(gainNode);
  } else {
    oscillator.connect(gainNode);
  }
  gainNode.connect(output);
  gainNode.gain.setValueAtTime(0.001, start);
  gainNode.gain.linearRampToValueAtTime(peak, start + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.001, end);
  oscillator.start(start);
  oscillator.stop(end);

  return end - now;
}

function scheduleTones(tones: Tone[]): SoundScheduler {
  return (audioContext, output, now) => Math.max(...tones.map((tone) => scheduleTone(audioContext, output, now, tone)));
}

function scheduleNoise(
  audioContext: AudioContext,
  output: GainNode,
  now: number,
  start: number,
  duration: number,
  volume: number,
  filterFrequency: number,
) {
  const frameCount = Math.max(1, Math.ceil(audioContext.sampleRate * duration));
  const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }

  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gainNode = audioContext.createGain();
  const absoluteStart = now + start;
  const absoluteEnd = absoluteStart + duration;

  source.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(filterFrequency, absoluteStart);
  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(output);
  gainNode.gain.setValueAtTime(Math.max(0.001, volume), absoluteStart);
  gainNode.gain.exponentialRampToValueAtTime(0.001, absoluteEnd);
  source.start(absoluteStart);
  source.stop(absoluteEnd);

  return absoluteEnd - now;
}

function schedulePianoNote(audioContext: AudioContext, output: GainNode, now: number, frequency: number, start: number) {
  return Math.max(
    scheduleTone(audioContext, output, now, { frequency, start, duration: 0.55, type: 'triangle', volume: 0.24, filterFrequency: 1800 }),
    scheduleTone(audioContext, output, now, { frequency: frequency * 2, start, duration: 0.28, type: 'sine', volume: 0.08 }),
    scheduleTone(audioContext, output, now, { frequency: frequency * 3, start, duration: 0.16, type: 'sine', volume: 0.035 }),
  );
}

function scheduleViolinNote(audioContext: AudioContext, output: GainNode, now: number, frequency: number, start: number) {
  return scheduleTone(audioContext, output, now, {
    frequency,
    start,
    duration: 0.48,
    type: 'sawtooth',
    volume: 0.12,
    filterFrequency: 1300,
  });
}

const CHIME_SOUNDS: Record<TimerChime, SoundScheduler> = {
  'double-beep': scheduleTones(CLASSIC_TONES['double-beep']),
  bell: scheduleTones(CLASSIC_TONES.bell),
  digital: scheduleTones(CLASSIC_TONES.digital),
  'soft-pulse': scheduleTones(CLASSIC_TONES['soft-pulse']),

  'bird-chirp': (audioContext, output, now) => Math.max(
    scheduleTone(audioContext, output, now, { frequency: 1750, endFrequency: 2650, start: 0, duration: 0.18, type: 'sine', volume: 0.2 }),
    scheduleTone(audioContext, output, now, { frequency: 2200, endFrequency: 3100, start: 0.23, duration: 0.16, type: 'sine', volume: 0.16 }),
  ),
  'mouth-click': (audioContext, output, now) => Math.max(
    scheduleNoise(audioContext, output, now, 0, 0.018, 0.16, 1800),
    scheduleNoise(audioContext, output, now, 0.16, 0.018, 0.13, 1800),
    scheduleTone(audioContext, output, now, { frequency: 520, start: 0.01, duration: 0.08, type: 'sine', volume: 0.08 }),
  ),
  'finger-snap': (audioContext, output, now) => Math.max(
    scheduleNoise(audioContext, output, now, 0, 0.026, 0.2, 2200),
    scheduleNoise(audioContext, output, now, 0.035, 0.014, 0.1, 3600),
    scheduleNoise(audioContext, output, now, 0.09, 0.012, 0.06, 3000),
  ),
  'lightning-crackle': (audioContext, output, now) => Math.max(
    scheduleNoise(audioContext, output, now, 0, 0.014, 0.13, 1500),
    scheduleNoise(audioContext, output, now, 0.055, 0.012, 0.1, 1900),
    scheduleNoise(audioContext, output, now, 0.12, 0.018, 0.14, 1400),
    scheduleNoise(audioContext, output, now, 0.2, 0.012, 0.08, 2200),
    scheduleNoise(audioContext, output, now, 0.28, 0.016, 0.06, 1800),
  ),

  'robotic-confirm': (audioContext, output, now) => Math.max(
    scheduleTone(audioContext, output, now, { frequency: 260, start: 0, duration: 0.11, type: 'square', volume: 0.13, filterFrequency: 1800 }),
    scheduleTone(audioContext, output, now, { frequency: 390, start: 0.14, duration: 0.11, type: 'square', volume: 0.12, filterFrequency: 1800 }),
    scheduleTone(audioContext, output, now, { frequency: 520, start: 0.28, duration: 0.2, type: 'triangle', volume: 0.15, filterFrequency: 1800 }),
  ),
  'robotic-scan': (audioContext, output, now) => Math.max(
    scheduleTone(audioContext, output, now, { frequency: 420, endFrequency: 880, start: 0, duration: 0.32, type: 'sine', volume: 0.16 }),
    scheduleTone(audioContext, output, now, { frequency: 880, endFrequency: 620, start: 0.4, duration: 0.24, type: 'sine', volume: 0.12 }),
  ),
  'mechanical-tick': (audioContext, output, now) => Math.max(
    scheduleNoise(audioContext, output, now, 0, 0.012, 0.1, 2600),
    scheduleTone(audioContext, output, now, { frequency: 300, start: 0.025, duration: 0.08, type: 'square', volume: 0.1, filterFrequency: 1200 }),
    scheduleNoise(audioContext, output, now, 0.16, 0.012, 0.08, 2600),
    scheduleTone(audioContext, output, now, { frequency: 450, start: 0.185, duration: 0.12, type: 'square', volume: 0.1, filterFrequency: 1200 }),
  ),

  'piano-tune': (audioContext, output, now) => Math.max(
    schedulePianoNote(audioContext, output, now, 523.25, 0),
    schedulePianoNote(audioContext, output, now, 659.25, 0.22),
    schedulePianoNote(audioContext, output, now, 783.99, 0.44),
  ),
  'violin-tune': (audioContext, output, now) => Math.max(
    scheduleViolinNote(audioContext, output, now, 392, 0),
    scheduleViolinNote(audioContext, output, now, 493.88, 0.22),
    scheduleViolinNote(audioContext, output, now, 587.33, 0.44),
  ),
  'triangle-tune': scheduleTones([
    { frequency: 523.25, start: 0, duration: 0.28, type: 'triangle', volume: 0.16 },
    { frequency: 659.25, start: 0.24, duration: 0.28, type: 'triangle', volume: 0.14 },
    { frequency: 783.99, start: 0.48, duration: 0.42, type: 'triangle', volume: 0.16 },
  ]),
};

export function playTimerSound({ chime = 'double-beep', volume = 0.3 }: { chime?: TimerChime; volume?: number } = {}) {
  try {
    if (volume <= 0) return;
    const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextConstructor();
    const now = audioContext.currentTime;
    const masterGain = audioContext.createGain();
    const gain = Math.min(1, Math.max(0, volume));
    const schedule = CHIME_SOUNDS[chime] ?? CHIME_SOUNDS['double-beep'];

    masterGain.gain.setValueAtTime(gain, now);
    masterGain.connect(audioContext.destination);
    const duration = schedule(audioContext, masterGain, now);

    // Release the short-lived context after the last scheduled note finishes.
    window.setTimeout(() => { void audioContext.close(); }, (duration + 0.2) * 1000);
  } catch (e: any) {
    console.error('Audio playback failed:', e);
  }
}
