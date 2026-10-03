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
 *  - Removing an unfinished task mid-session says it was logged as completed.
 *  - A task added mid-session is timed from now, not from the session's
 *    start, so it doesn't start out overdue and chime straight away.
 *  - The chime goes off again for an overdue task whose deadline an edit
 *    moves back into the future, once the new deadline passes.
 *  - A Stop whose DELETE fails keeps retrying until the session is gone, but
 *    a retry never ends a session changed or restarted on another device
 *    meanwhile, or deletes a list staged here since.
 *
 * The repo has no DOM renderer for tests, so the real hook runs under the
 * small hooks runtime below, against a fake /api/active-session.
 */

import { toast } from 'sonner';
import { useSessionEngine } from '@/hooks/use-session-engine';
import { playTimerSound } from '@/lib/use-timer-sound';
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
let failingDeletes = 0;
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

// Mirrors app/api/active-session: GET returns the row, DELETE removes it (a
// retry only the version it names), and POST writes it only over the version
// the client last saw (or creates it if the client has seen none), otherwise
// answering 409 with the latest row.
function handleSessionRequest(method: string, body: any, url: string) {
  if (method === 'GET') {
    if (failingGets > 0) {
      failingGets -= 1;
      return reply(500, { error: 'Failed to fetch session' });
    }
    return reply(200, sessionRow);
  }
  if (method === 'DELETE') {
    if (failingDeletes > 0) {
      failingDeletes -= 1;
      return reply(500, { error: 'Failed to delete session' });
    }
    const version = new URL(url, 'http://localhost').searchParams.get('lastKnownUpdatedAt');
    if (version && sessionRow && sessionRow.updatedAt !== version) {
      return reply(409, { error: 'Session was updated elsewhere', conflict: true, latest: sessionRow });
    }
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

  if (url.split('?')[0] === '/api/active-session') {
    const response = handleSessionRequest(method, body, url);
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
const sessionDeletes = () => sentRequests.filter((r) => r.url.split('?')[0] === '/api/active-session' && r.method === 'DELETE');
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

const renderEngine = (alarmEnabled = false) =>
  renderHook(() => useSessionEngine(true, alarmEnabled, 'double-beep', 0));

// Logged in, with tasks (by default one 10-minute task) staged, started, and
// saved as running.
async function startRunningSession({
  tasks = [['Write report', 600]] as [string, number][],
  alarmEnabled = false,
} = {}) {
  const engine = renderEngine(alarmEnabled);
  await flushMicrotasks(); // initial load: no saved session yet
  tasks.forEach(([name, seconds]) => engine.current.handleAddTask(name, seconds));
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
  failingDeletes = 0;
  advanceMovesGoal = true;
  holdGoalSteps = false;
  heldGoalStepReplies = [];
  renderErrors = [];
  mockDocument.visibilityState = 'visible';
  (playTimerSound as jest.Mock).mockClear();
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

describe('removing a task mid-session', () => {
  test('says the task was logged as completed', async () => {
    const engine = await startRunningSession();
    (toast.success as jest.Mock).mockClear();

    engine.current.handleDeleteTask(engine.current.tasks[0].id);

    expect(toast.success).toHaveBeenCalledWith('Task logged as completed');
  });
});

describe('adding a task mid-session', () => {
  test('Add to Top gives it its full time from now, and the task it goes ahead of keeps what it had left', async () => {
    const engine = await startRunningSession(); // a 10-minute task
    await advance(4 * 60_000);
    const reportLeft = engine.current.getRemainingTime(engine.current.tasks[0]);

    engine.current.handleAddTask('Call back', 300, 'top');
    await flushMicrotasks();

    const [call, report] = engine.current.tasks;
    expect(call.name).toBe('Call back');
    expect(engine.current.getRemainingTime(call)).toBe(300);
    expect(engine.current.getRemainingTime(report)).toBe(reportLeft + 300);
    expect(engine.current.sessionTotalSeconds).toBe(900);
  });

  test('once the session has run over, Add to Bottom and Task Bank adds start now instead of overdue', async () => {
    const engine = await startRunningSession(); // a 10-minute task
    await advance(16 * 60_000); // six minutes over

    engine.current.handleAddTask('Call back', 300);
    await flushMicrotasks();
    engine.current.handleAddFromBank([{ bankTask: { ...goalCursor, id: 'bank-1', name: 'Tidy desk', durationSeconds: 300 } }]);
    await flushMicrotasks();

    const [, call, tidy] = engine.current.tasks;
    expect(engine.current.getRemainingTime(call)).toBe(300);
    expect(engine.current.getRemainingTime(tidy)).toBe(600);
  });
});

describe('the timer chime', () => {
  test('goes off again for an overdue task made longer, when its new deadline passes', async () => {
    const engine = await startRunningSession({ alarmEnabled: true });
    await advance(11 * 60_000); // the 10-minute task is a minute overdue
    expect(playTimerSound).toHaveBeenCalledTimes(1);

    engine.current.handleEditTask(engine.current.tasks[0].id, 'Write report', 15 * 60);
    await advance(3 * 60_000);
    expect(playTimerSound).toHaveBeenCalledTimes(1);
    await advance(2 * 60_000); // past the new 15-minute deadline
    expect(playTimerSound).toHaveBeenCalledTimes(2);
  });

  test('goes off again for an overdue task moved down the list, when its new deadline passes', async () => {
    const engine = await startRunningSession({ tasks: [['Write report', 600], ['Email', 600]], alarmEnabled: true });
    await advance(11 * 60_000); // the report is a minute overdue
    expect(playTimerSound).toHaveBeenCalledTimes(1);

    const [report, email] = engine.current.tasks;
    engine.current.handleReorder([email, report]);
    await advance(1000);
    // The email takes over the report's slot, whose deadline has passed.
    expect(playTimerSound).toHaveBeenCalledTimes(2);

    await advance(9 * 60_000); // past the report's new deadline at 20 minutes
    expect(playTimerSound).toHaveBeenCalledTimes(3);
  });

  test("a task added at the top of an overdue one doesn't chime at once, then one chime covers both", async () => {
    const engine = await startRunningSession({ alarmEnabled: true });
    await advance(11 * 60_000); // the 10-minute task is a minute overdue
    expect(playTimerSound).toHaveBeenCalledTimes(1);

    engine.current.handleAddTask('Call back', 300, 'top');
    await advance(1000);
    expect(playTimerSound).toHaveBeenCalledTimes(1);

    // The overdue task now ends with the new one: their deadlines pass together.
    await advance(5 * 60_000);
    expect(playTimerSound).toHaveBeenCalledTimes(2);
  });
});

describe('a Stop the server fails to carry out', () => {
  // Logged in, with the session's only task done and saved, so Stop deletes
  // the session; the first `failures` DELETEs fail.
  async function stopWithFailingDeletes(failures: number) {
    const engine = await startRunningSession();
    engine.current.handleMarkDone(engine.current.tasks[0].id);
    await advance(1000);
    failingDeletes = failures;
    engine.current.handleStop();
    await flushMicrotasks();
    return engine;
  }

  test('is retried, saying so, until the session is gone', async () => {
    (toast.error as jest.Mock).mockClear();
    await stopWithFailingDeletes(2);
    expect(sessionRow).not.toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Couldn't end your session — retrying", { id: 'session-save-error' });

    await advance(6000); // two retries, three seconds apart

    expect(sessionDeletes()).toHaveLength(3);
    expect(sessionRow).toBeNull();
    expect(toast.dismiss).toHaveBeenLastCalledWith('session-save-error');
  });

  test('a retry doesn’t end a new session started on another device meanwhile, and switches to it', async () => {
    const engine = await stopWithFailingDeletes(1);
    sessionRow = otherDeviceSession(); // the phone stopped it too, then started another

    await advance(3000);

    expect(taskNames(sessionRow.tasks)).toEqual(['Read chapter 3']);
    expect(engine.current.sessionState).toBe('running');
    expect(taskNames(engine.current.tasks)).toEqual(['Read chapter 3']);
  });

  test('a list staged here while it retries replaces the stopped session instead of being deleted', async () => {
    const engine = await stopWithFailingDeletes(1);

    engine.current.handleAddTask('Next thing', 300);
    await advance(6000);

    expect(sessionDeletes()).toHaveLength(1);
    expect(sessionRow).toMatchObject({ sessionState: 'idle' });
    expect(taskNames(sessionRow.tasks)).toEqual(['Next thing']);
  });
});
