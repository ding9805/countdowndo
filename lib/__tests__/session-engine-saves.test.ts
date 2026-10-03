/**
 * Regression tests for how useSessionEngine persists the active session:
 *
 *  - A save requested by an async callback (the completion-log id attach) is
 *    built from the state when it is sent, so it can't roll back a pause made
 *    while the log request was out.
 *  - A save still waiting on its debounce is sent, not dropped, when the
 *    engine unmounts or the page is hidden or unloaded.
 *  - After a 409, a debounced save built from pre-conflict state is dropped
 *    instead of overwriting the session just adopted from the other device.
 *
 * The repo has no DOM renderer for tests, so the real hook runs under the
 * small hooks runtime below, against a fake /api/active-session.
 */

import { useSessionEngine } from '@/hooks/use-session-engine';

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
jest.mock('@/lib/use-timer-sound', () => ({ playTimerSound: jest.fn() }));

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
let holdSessionPosts = false;
let heldSessionReplies: (() => void)[] = [];

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function nextUpdatedAt(): string {
  rowVersion += 1;
  return new Date(Date.UTC(2026, 9, 1) + rowVersion * 1000).toISOString();
}

// Mirrors app/api/active-session: GET returns the row, DELETE removes it, POST
// upserts it after the same optimistic-concurrency check.
function handleSessionRequest(method: string, body: any) {
  if (method === 'GET') return reply(200, sessionRow);
  if (method === 'DELETE') {
    sessionRow = null;
    return reply(200, { success: true });
  }
  const { lastKnownUpdatedAt, ...data } = body;
  if (lastKnownUpdatedAt && sessionRow && Date.parse(sessionRow.updatedAt) > Date.parse(lastKnownUpdatedAt)) {
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
    if (method === 'POST' && holdSessionPosts) {
      return new Promise<ReturnType<typeof reply>>((resolve) => heldSessionReplies.push(() => resolve(response)));
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

// Logged in, with one 10-minute task staged, started, and saved as running.
async function startRunningSession() {
  const engine = renderHook(() => useSessionEngine(true, false, 'double-beep', 0));
  await flushMicrotasks(); // initial load: no saved session yet
  engine.current.handleAddTask('Write report', 600);
  await advance(1000);
  engine.current.handleStartSession();
  await advance(1000);
  expect(lastSessionPost().body.sessionState).toBe('running');
  return engine;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-03T09:00:00Z'));
  sessionRow = null;
  rowVersion = 0;
  sentRequests = [];
  heldLogReplies = [];
  holdSessionPosts = false;
  heldSessionReplies = [];
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

    holdSessionPosts = true;
    engine.current.handleEditTask(taskId, 'Edit A', 600);
    await advance(1000); // edit A is sent and answered 409, but the reply is held
    engine.current.handleEditTask(taskId, 'Edit B', 600); // debounced behind it
    await flushMicrotasks();
    const postsBefore = sessionPosts().length;

    holdSessionPosts = false;
    heldSessionReplies.shift()!();
    await advance(1500);

    expect(sessionPosts()).toHaveLength(postsBefore);
    expect(engine.current.tasks[0].name).toBe('Renamed on phone');
    expect(sessionRow.tasks[0].name).toBe('Renamed on phone');
  });
});
