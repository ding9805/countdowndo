/**
 * Regression tests for the audio context behind the timer chime.
 *
 * Browsers only let audio start from a user gesture (iOS Safari strictly so),
 * and chimes go off from a timer. A context made on the spot for each chime
 * never started on an iPhone, so the chime stayed silent. One context is now
 * kept for the page, started by a tap, and reused for every chime.
 */

type Sound = typeof import('@/lib/use-timer-sound');

// Whether the browser would let an audio context start right now: only
// inside a gesture, unless a test says otherwise.
let canStart = false;
let contexts: FakeAudioContext[] = [];
let notesPlayed = 0;

const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  private waitingToStart: (() => void)[] = [];

  constructor() {
    contexts.push(this);
    if (canStart) this.state = 'running';
  }

  // Like a browser: resolves once the context is allowed to start, which
  // can be much later.
  resume() {
    if (!canStart) return new Promise<void>((resolve) => this.waitingToStart.push(resolve));
    this.state = 'running';
    this.waitingToStart.splice(0).forEach((resolve) => resolve());
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain() {
    return { gain: param(), connect() {}, disconnect() {} };
  }

  createOscillator() {
    return { type: 'sine', frequency: param(), connect() {}, start: () => { notesPlayed += 1; }, stop() {} };
  }

  createBiquadFilter() {
    return { type: 'lowpass', frequency: param(), connect() {} };
  }

  createBuffer() {
    return { getChannelData: () => new Float32Array(1) };
  }

  createBufferSource() {
    return { buffer: null, connect() {}, start() {}, stop() {} };
  }
}

let sound: Sound;

function tap(handler: () => void) {
  canStart = true;
  try {
    handler();
  } finally {
    canStart = false;
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  canStart = false;
  contexts = [];
  notesPlayed = 0;
  Object.assign(globalThis, {
    window: { AudioContext: FakeAudioContext, setTimeout: (run: () => void, ms: number) => setTimeout(run, ms) },
  });
  jest.isolateModules(() => {
    sound = require('@/lib/use-timer-sound');
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('timer chime audio', () => {
  test('every chime plays through the one context a tap started, which stays open', async () => {
    tap(sound.unlockTimerSound);

    sound.playTimerSound();
    jest.advanceTimersByTime(60_000);
    sound.playTimerSound();
    await flushMicrotasks();

    expect(contexts).toHaveLength(1);
    expect(contexts[0].state).toBe('running');
    expect(notesPlayed).toBe(4); // two beeps per chime
  });

  test('a chime due before any tap is dropped instead of going off at the next tap', async () => {
    sound.playTimerSound();
    await flushMicrotasks();
    expect(notesPlayed).toBe(0);

    jest.advanceTimersByTime(5 * 60_000);
    tap(sound.unlockTimerSound);
    await flushMicrotasks();
    expect(notesPlayed).toBe(0);

    sound.playTimerSound();
    await flushMicrotasks();
    expect(notesPlayed).toBe(2);
  });

  test('a context suspended in the background is resumed for a chime once the page has been used', async () => {
    tap(sound.unlockTimerSound);
    contexts[0].state = 'suspended';
    canStart = true; // the page was tapped earlier, so resuming is allowed

    sound.playTimerSound();
    await flushMicrotasks();

    expect(contexts).toHaveLength(1);
    expect(notesPlayed).toBe(2);
  });
});
