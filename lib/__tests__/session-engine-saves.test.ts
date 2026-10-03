/**
 * Regression tests for useSessionEngine, mostly how it persists the active
 * session:
 *
 *  - A save requested by an async callback (the completion-log id attach) is
 *    built from the state when it is sent, so it can't roll back a pause made
 *    while the log request was out.
 *  - A save still waiting on its debounce is sent, not dropped, when the
 *    engine unmounts or the page is hidden or unloaded.
 *  - After a 409, a debounced save built from pre-conflict state is dropped
 *    instead of overwriting the session just adopted from the other device.
 *  - Saves only replace the server's version they were built on: a client
 *    that hasn't loaded the session (a failed or slow first load, or one that
 *    loaded none) can't overwrite one that exists, and a device that missed
 *    a Stop doesn't bring the session back.
 *  - Un-marking a goal task rolls the goal back only if marking it done
 *    actually moved it — not for an extra copy marked done after the goal was
 *    complete — and that's saved with the task for other devices.
 *
 * The repo has no DOM renderer for tests, so the real hook runs under the
 * small hooks runtime below, against a fake /api/active-session.
 */

import { useSessionEngine } from '@/hooks/use-session-engine';
import type { BankTask } from '@/lib/types';

jest.mock('react', () => ({
  useState: (initial: any) => mockUseState(initial),
  useRef: (initial: any) => mockUseRef(initial),
  useCallback: (fn: any, deps: unknown[]) => mockUseCallback(fn, deps),
  useEffect: (effect: () => unknown, deps?: unknown[]) => mockUseEffect(effect, deps),
}));
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), info: jest.fn(), error: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock('@/lib/celebrate', () => ({ celebrate: jest.fn() }));
jest.mock('@/lib/use-timer-sound', () => ({ playTimerSound: jest.fn(), unlockTimerSound: jest.fn() }));

// ── Minimal hooks runtime ────────────────────────────────────────────────
// Re-renders after state changes (batched into a microtask) and runs effects
// after each render — every due cleanup first, then every due effect.

let mockSlots: any[] = [];
let mockCursor = 0;
let mockDueEffects: { index: number; effect: () => unknown; deps?: unknown[] }[] = [];
let mockRequestRender: () => void = () => {};
let renderErrors: unknown[] = [];

function mockDepsChanged(prev: unknown[] | undefined, next: unknown[] | undefined): boolean {
  if (!prev || !next || prev.length !== next.length) return true;
  return prev.some((dep, i) => !Object.is(dep, next[i]));
}

function mockUseState(initial: any) {
  const index = mockCursor++;
  if (!mockSlots[index]) {
    const slot: any = { value: typeof initial === 'function' ? initial() : initial };
    slot.set = (update: any) => {
      const next = typeof update === 'function' ? update(slot.value) : update;
      if (Object.is(next, slot.value)) return;
      slot.value = next;
      mockRequestRender();
    };
    mockSlots[index] = slot;
  }
  return [mockSlots[index].value, mockSlots[index].set];
}

function mockUseRef(initial: any) {
  const index = mockCursor++;
  if (!mockSlots[index]) mockSlots[index] = { current: initial };
  return mockSlots[index];
}

function mockUseCallback(fn: any, deps: unknown[]) {
  const index = mockCursor++;
  if (!mockSlots[index] || mockDepsChanged(mockSlots[index].deps, deps)) mockSlots[index] = { fn, deps };
  return mockSlots[index].fn;
}

function mockUseEffect(effect: () => unknown, deps?: unknown[]) {
  const index = mockCursor++;
  const slot = mockSlots[index];
  if (!slot) mockSlots[index] = {};
  if (!slot || mockDepsChanged(slot.deps, deps)) mockDueEffects.push({ index, effect, deps });
}

interface HookHandle<T> {
  readonly current: T;
  unmount(): void;
}

let activeHook: HookHandle<unknown> | null = null;

function renderHook<T>(hook: () => T): HookHandle<T> {
  mockSlots = [];
  let result!: T;
  let mounted = true;
  let renderRequested = false;

  const render = () => {
    mockCursor = 0;
    mockDueEffects = [];
    result = hook();
    const due = mockDueEffects;
    for (const { index } of due) {
      const cleanup = mockSlots[index].cleanup;
      if (typeof cleanup === 'function') cleanup();
    }
    for (const { index, effect, deps } of due) {
      mockSlots[index].cleanup = effect();
      mockSlots[index].deps = deps;
    }
  };

  mockRequestRender = () => {
    if (!mounted || renderRequested) return;
    renderRequested = true;
    Promise.resolve().then(() => {
      renderRequested = false;
      if (!mounted) return;
      try {
        render();
      } catch (error) {
        renderErrors.push(error);
      }
    });
  };

  render();
  const handle: HookHandle<T> = {
    get current() {
      return result;
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      for (const slot of mockSlots) {
        if (slot && typeof slot.cleanup === 'function') slot.cleanup();
      }
    },
  };
  activeHook = handle;
  return handle;
}

async function flushMicrotasks() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function advance(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

// ── Fake server ──────────────────────────────────────────────────────────

interface SentRequest {
  url: string;
  method: string;
  body: any;
  keepalive?: boolean;
}

let sessionRow: any = null;
let rowVersion = 0;
let sentRequests: SentRequest[] = [];
let heldLogReplies: ((logId: string) => void)[] = [];
// Methods whose /api/active-session replies are held until a test releases
// them, in order, from heldSessionReplies.
let heldMethods = new Set<string>();
let heldSessionReplies: (() => void)[] = [];
let failingGets = 0;
// Whether a goal advance moves its goal (it doesn't once the goal is
// complete), and whether /api/goals/step replies are held for a test to
// release from heldGoalStepReplies.
let advanceMovesGoal = true;
let holdGoalSteps = false;
let heldGoalStepReplies: (() => void)[] = [];

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function nextUpdatedAt(): string {
  rowVersion += 1;
  return new Date(Date.UTC(2026, 9, 1) + rowVersion * 1000).toISOString();
}

// Mirrors app/api/active-session: GET returns the row, DELETE removes it, and
// POST writes it only over the version the client last saw (or creates it if
// the client has seen none), otherwise answering 409 with the latest row.
function handleSessionRequest(method: string, body: any) {
  if (method === 'GET') {
    if (failingGets > 0) {
      failingGets -= 1;
      return reply(500, { error: 'Failed to fetch session' });
    }
    return reply(200, sessionRow);
  }
  if (method === 'DELETE') {
    sessionRow = null;
    return reply(200, { success: true });
  }
  const { lastKnownUpdatedAt, ...data } = body;
  if ((sessionRow?.updatedAt ?? null) !== (lastKnownUpdatedAt ?? null)) {
    return reply(409, { error: 'Session was updated elsewhere', conflict: true, latest: sessionRow });
  }
  sessionRow = { ...data, updatedAt: nextUpdatedAt() };
  return reply(200, sessionRow);
}

const mockFetch = jest.fn(async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  sentRequests.push({ url, method, body, keepalive: init.keepalive });

  if (url === '/api/active-session') {
    const response = handleSessionRequest(method, body);
    if (heldMethods.has(method)) {
      return new Promise<ReturnType<typeof reply>>((resolve) => heldSessionReplies.push(() => resolve(response)));
    }
    return response;
  }
  if (url === '/api/goals/step') {
    const response = reply(200, { goal: {}, moved: body.direction === 'retreat' || advanceMovesGoal });
    if (holdGoalSteps) {
      return new Promise<ReturnType<typeof reply>>((resolve) => heldGoalStepReplies.push(() => resolve(response)));
    }
    return response;
  }
  if (url === '/api/completion-log' && method === 'POST') {
    // Held open to model a slow request; each test decides when it answers.
    return new Promise<ReturnType<typeof reply>>((resolve) => {
      heldLogReplies.push((logId) => resolve(reply(200, { count: 1, logs: [{ id: logId }] })));
    });
  }
  return reply(200, {});
});

const mockWindow = new EventTarget();
const mockDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
Object.assign(globalThis, { window: mockWindow, document: mockDocument, fetch: mockFetch });

const sessionPosts = () => sentRequests.filter((r) => r.url === '/api/active-session' && r.method === 'POST');
const lastSessionPost = () => {
  const posts = sessionPosts();
  return posts[posts.length - 1];
};

const taskNames = (tasks: { name: string }[]) => tasks.map((task) => task.name);
const goalSteps = () => sentRequests.filter((r) => r.url === '/api/goals/step').map((r) => r.body.direction);

// A session saved by another device: one 15-minute task, running (or staged).
function otherDeviceSession(sessionState: 'running' | 'idle' = 'running') {
  return {
    tasks: [{
      id: 'phone-task',
      name: 'Read chapter 3',
      durationSeconds: 900,
      cumulativeSeconds: 900,
      isDone: false,
      doneAt: null,
      bonusSeconds: 0,
      color: 'blue',
    }],
    sessionState,
    sessionStartMs: Date.now(),
    pausedElapsed: 0,
    soundPlayed: [],
    sessionMode: 'continuous',
    sessionTotalSeconds: 900,
    updatedAt: nextUpdatedAt(),
  };
}

const renderEngine = () => renderHook(() => useSessionEngine(true, false, 'double-beep', 0));

// Logged in, with one 10-minute task staged, started, and saved as running.
async function startRunningSession() {
  const engine = renderEngine();
  await flushMicrotasks(); // initial load: no saved session yet
  engine.current.handleAddTask('Write report', 600);
  await advance(1000);
  engine.current.handleStartSession();
  await advance(1000);
  expect(lastSessionPost().body.sessionState).toBe('running');
  return engine;
}

// A goal's cursor task in the Task Bank.
const goalCursor: BankTask = {
  id: 'cursor-1',
  name: 'Read: 90–100 pages',
  durationSeconds: 600,
  color: 'orange',
  tags: [],
  isOneOff: false,
  dueDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

// Logged in, running a session of one copy of the goal's cursor task.
async function startGoalSession() {
  const engine = renderEngine();
  await flushMicrotasks();
  engine.current.handleAddFromBank([{ bankTask: goalCursor }]);
  await advance(1000);
  engine.current.handleStartSession();
  await advance(1000);
  return engine;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-03T09:00:00Z'));
  sessionRow = null;
  rowVersion = 0;
  sentRequests = [];
  heldLogReplies = [];
  heldMethods = new Set();
  heldSessionReplies = [];
  failingGets = 0;
  advanceMovesGoal = true;
  holdGoalSteps = false;
  heldGoalStepReplies = [];
  renderErrors = [];
  mockDocument.visibilityState = 'visible';
});

afterEach(() => {
  activeHook?.unmount();
  activeHook = null;
  jest.useRealTimers();
  expect(renderErrors).toEqual([]);
});

describe('a late completion-log id', () => {
  test('saves the paused session rather than the state from before the pause', async () => {
    const engine = await startRunningSession();

    engine.current.handleMarkDone(engine.current.tasks[0].id); // log request stays open
    await flushMicrotasks();
    engine.current.handlePause();
    await flushMicrotasks();
    const pausedElapsed = engine.current.pausedElapsed;

    heldLogReplies.shift()!('log-1');
    await advance(1000);

    const saved = lastSessionPost().body;
    expect(saved.sessionState).toBe('paused');
    expect(saved.pausedElapsed).toBe(pausedElapsed);
    expect(saved.tasks[0]).toMatchObject({ isDone: true, completionLogId: 'log-1' });
  });
});

describe('a save still waiting on its debounce', () => {
  test('is sent when the engine unmounts, e.g. navigating to Task Bank right after marking done', async () => {
    const engine = await startRunningSession();
    engine.current.handleMarkDone(engine.current.tasks[0].id);
    await flushMicrotasks();
    const postsBefore = sessionPosts().length;

    engine.unmount();
    await flushMicrotasks();

    expect(sessionPosts()).toHaveLength(postsBefore + 1);
    expect(lastSessionPost().body.tasks[0].isDone).toBe(true);
  });

  test('unmounting with nothing pending sends nothing', async () => {
    const engine = await startRunningSession();
    const postsBefore = sessionPosts().length;

    engine.unmount();
    await flushMicrotasks();

    expect(sessionPosts()).toHaveLength(postsBefore);
  });

  test('is sent with keepalive on pagehide', async () => {
    const engine = await startRunningSession();
    engine.current.handleMarkDone(engine.current.tasks[0].id);
    await flushMicrotasks();
    const postsBefore = sessionPosts().length;

    mockWindow.dispatchEvent(new Event('pagehide'));
    await flushMicrotasks();

    expect(sessionPosts()).toHaveLength(postsBefore + 1);
    expect(lastSessionPost().keepalive).toBe(true);
    expect(lastSessionPost().body.tasks[0].isDone).toBe(true);
  });

  test('is sent with keepalive when the page is hidden', async () => {
    const engine = await startRunningSession();
    engine.current.handlePause();
    await flushMicrotasks();
    const postsBefore = sessionPosts().length;

    mockDocument.visibilityState = 'hidden';
    mockDocument.dispatchEvent(new Event('visibilitychange'));
    await flushMicrotasks();

    expect(sessionPosts()).toHaveLength(postsBefore + 1);
    expect(lastSessionPost()).toMatchObject({ keepalive: true, body: { sessionState: 'paused' } });
  });
});

describe('a 409 conflict', () => {
  test('drops a debounced save made before the conflict instead of overwriting the adopted session', async () => {
    const engine = await startRunningSession();
    const taskId = engine.current.tasks[0].id;

    // Another device renames the task.
    sessionRow = {
      ...sessionRow,
      tasks: sessionRow.tasks.map((task: any) => ({ ...task, name: 'Renamed on phone' })),
      updatedAt: nextUpdatedAt(),
    };

    heldMethods.add('POST');
    engine.current.handleEditTask(taskId, 'Edit A', 600);
    await advance(1000); // edit A is sent and answered 409, but the reply is held
    engine.current.handleEditTask(taskId, 'Edit B', 600); // debounced behind it
    await flushMicrotasks();
    const postsBefore = sessionPosts().length;

    heldMethods.delete('POST');
    heldSessionReplies.shift()!();
    await advance(1500);

    expect(sessionPosts()).toHaveLength(postsBefore);
    expect(engine.current.tasks[0].name).toBe('Renamed on phone');
    expect(sessionRow.tasks[0].name).toBe('Renamed on phone');
  });
});

describe('a save the server has no matching version for', () => {
  test('a failed first load is retried until the session shows up', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    sessionRow = otherDeviceSession();
    failingGets = 1;

    const engine = renderEngine();
    await flushMicrotasks();
    expect(engine.current.tasks).toEqual([]);

    await advance(3000);

    expect(engine.current.sessionState).toBe('running');
    expect(taskNames(engine.current.tasks)).toEqual(['Read chapter 3']);
    expect(sessionPosts()).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  test('an edit made while the first load is out does not overwrite the session it loads', async () => {
    sessionRow = otherDeviceSession();
    heldMethods.add('GET');
    const engine = renderEngine();
    await flushMicrotasks();

    engine.current.handleAddTask('Added before the load', 300);
    heldMethods.delete('GET');
    heldSessionReplies.shift()!();
    await advance(1000);

    expect(taskNames(sessionRow.tasks)).toEqual(['Read chapter 3']);
    expect(taskNames(engine.current.tasks)).toEqual(['Read chapter 3']);
  });

  test('a device that loaded no session adopts one started elsewhere instead of overwriting it', async () => {
    const engine = renderEngine();
    await flushMicrotasks(); // nothing saved yet
    sessionRow = otherDeviceSession(); // then the phone starts a session

    engine.current.handleAddTask('Staged on laptop', 300);
    await advance(1000);

    expect(lastSessionPost().body.lastKnownUpdatedAt).toBeNull();
    expect(taskNames(sessionRow.tasks)).toEqual(['Read chapter 3']);
    expect(engine.current.sessionState).toBe('running');
    expect(taskNames(engine.current.tasks)).toEqual(['Read chapter 3']);
  });

  test('a device that missed a Stop goes idle instead of bringing the session back', async () => {
    const engine = await startRunningSession();
    sessionRow = null; // stopped on another device with everything done

    engine.current.handleMarkDone(engine.current.tasks[0].id);
    await advance(1000);

    expect(lastSessionPost().body.lastKnownUpdatedAt).not.toBeNull();
    expect(engine.current.sessionState).toBe('idle');
    expect(engine.current.tasks).toEqual([]);
    await advance(6000);
    expect(sessionRow).toBeNull();
  });

  test('a list staged before another device ran and stopped it can still be started', async () => {
    sessionRow = otherDeviceSession('idle');
    const engine = renderEngine();
    await flushMicrotasks();
    sessionRow = null; // the phone started this list, then stopped it

    engine.current.handleStartSession();
    await advance(1000);

    const [rejected, created] = sessionPosts().slice(-2);
    expect(rejected.body.lastKnownUpdatedAt).not.toBeNull();
    expect(created.body.lastKnownUpdatedAt).toBeNull();
    expect(sessionRow).toMatchObject({ sessionState: 'running' });
    expect(engine.current.sessionState).toBe('running');
  });

  test('a save made right after Stop waits for the DELETE, then creates a new session', async () => {
    const engine = await startRunningSession();
    engine.current.handleMarkDone(engine.current.tasks[0].id);
    await flushMicrotasks();
    heldMethods.add('DELETE');
    engine.current.handleStop(); // nothing left, so the row is deleted
    await flushMicrotasks();

    engine.current.handleAddTask('Next thing', 300);
    const postsBefore = sessionPosts().length;
    await advance(1000);
    expect(sessionPosts()).toHaveLength(postsBefore);

    heldMethods.delete('DELETE');
    heldSessionReplies.shift()!();
    await flushMicrotasks();

    expect(sessionPosts()).toHaveLength(postsBefore + 1);
    expect(lastSessionPost().body.lastKnownUpdatedAt).toBeNull();
    expect(taskNames(sessionRow.tasks)).toEqual(['Next thing']);
  });
});

describe('un-marking a goal task', () => {
  test('rolls the goal back when marking it done moved the goal', async () => {
    const engine = await startGoalSession();
    const taskId = engine.current.tasks[0].id;

    engine.current.handleMarkDone(taskId);
    await flushMicrotasks();
    engine.current.handleMarkDone(taskId);
    await flushMicrotasks();

    expect(goalSteps()).toEqual(['advance', 'retreat']);
  });

  test('leaves a completed goal alone when marking an extra copy done moved nothing', async () => {
    const engine = await startGoalSession();
    const taskId = engine.current.tasks[0].id;
    advanceMovesGoal = false; // the goal was already complete

    engine.current.handleMarkDone(taskId);
    await flushMicrotasks();
    engine.current.handleMarkDone(taskId);
    await flushMicrotasks();

    expect(goalSteps()).toEqual(['advance']);
  });

  test.each([
    [true, ['advance', 'retreat']],
    [false, ['advance']],
  ])('un-marked before the advance answers (moved: %s), waits for the answer', async (moved, expected) => {
    const engine = await startGoalSession();
    const taskId = engine.current.tasks[0].id;
    advanceMovesGoal = moved;
    holdGoalSteps = true;

    engine.current.handleMarkDone(taskId);
    await flushMicrotasks();
    engine.current.handleMarkDone(taskId);
    await flushMicrotasks();
    expect(goalSteps()).toEqual(['advance']);

    holdGoalSteps = false;
    heldGoalStepReplies.shift()!();
    await flushMicrotasks();

    expect(goalSteps()).toEqual(expected);
  });

  test('another device un-marking it knows too: the result is saved with the task', async () => {
    const engine = await startGoalSession();
    advanceMovesGoal = false;
    engine.current.handleMarkDone(engine.current.tasks[0].id);
    await advance(1000);
    expect(lastSessionPost().body.tasks[0]).toMatchObject({ isDone: true, goalAdvanced: false });
    engine.unmount();

    const otherDevice = renderEngine();
    await flushMicrotasks();
    otherDevice.current.handleMarkDone(otherDevice.current.tasks[0].id);
    await flushMicrotasks();

    expect(otherDevice.current.tasks[0].isDone).toBe(false);
    expect(goalSteps()).toEqual(['advance']);
  });
});
