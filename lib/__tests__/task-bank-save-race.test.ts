/**
 * Regression tests for deleting or editing a Task Bank row that's still
 * saving.
 *
 * A new task or template shows at once under a placeholder id while the
 * request saving it is out. Deleting it in that window sent a DELETE for the
 * placeholder, which the server didn't know: "Failed to delete task", and the
 * row came back once the save finished. Editing failed the same way when the
 * dialog had opened on the placeholder, even if it was submitted after the
 * save. Both now wait for the save and use the id the server gave the row.
 *
 * The repo has no DOM renderer for tests, so the real page runs under the
 * small hooks runtime below, against a fake Task Bank API. Child components
 * are stubs: the tests find the page's handlers in the props it gives them.
 */

import { toast } from 'sonner';
import { TaskBankPage } from '@/components/task-bank/task-bank-page';
import { TaskBankCard } from '@/components/task-bank/task-bank-card';
import { TaskBankForm } from '@/components/task-bank/task-bank-form';
import { TemplateManagerDialog } from '@/components/task-bank/template-manager-dialog';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: any) => mockUseState(initial),
  useRef: (initial: any) => mockUseRef(initial),
  useMemo: (factory: () => unknown, deps: unknown[]) => mockUseMemo(factory, deps),
  useCallback: (fn: unknown, deps: unknown[]) => mockUseMemo(() => fn, deps),
  useEffect: (effect: () => unknown, deps?: unknown[]) => mockUseEffect(effect, deps),
}));
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, status: 'authenticated' }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('next/link', () => ({ __esModule: true, default: () => null }));
jest.mock('framer-motion', () => ({ AnimatePresence: () => null }));
jest.mock('lucide-react', () => ({ Sparkles: () => null, Archive: () => null, LogIn: () => null }));
jest.mock('@/components/ui/button', () => ({ Button: () => null }));
jest.mock('@/components/page-toggle', () => ({ PageToggle: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/task-bank/tag-filter-bar', () => ({ TagFilterBar: () => null }));
jest.mock('@/components/task-bank/task-bank-card', () => ({ TaskBankCard: () => null }));
jest.mock('@/components/task-bank/task-bank-form', () => ({ TaskBankForm: () => null }));
jest.mock('@/components/task-bank/template-manager-dialog', () => ({ TemplateManagerDialog: () => null }));

// ── Minimal hooks runtime ────────────────────────────────────────────────
// As in session-engine-saves.test.ts: re-renders after state changes
// (batched into a microtask) and runs due effects after each render.

let mockSlots: any[] = [];
let mockCursor = 0;
let mockDueEffects: { index: number; effect: () => unknown; deps?: unknown[] }[] = [];
let mockRequestRender: () => void = () => {};

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

function mockUseMemo(factory: () => unknown, deps: unknown[]) {
  const index = mockCursor++;
  if (!mockSlots[index] || mockDepsChanged(mockSlots[index].deps, deps)) mockSlots[index] = { value: factory(), deps };
  return mockSlots[index].value;
}

function mockUseEffect(effect: () => unknown, deps?: unknown[]) {
  const index = mockCursor++;
  const slot = mockSlots[index];
  if (!slot) mockSlots[index] = {};
  if (!slot || mockDepsChanged(slot.deps, deps)) mockDueEffects.push({ index, effect, deps });
}

let tree: any = null;
let mounted = false;

function renderPage() {
  mockSlots = [];
  mounted = true;
  let renderRequested = false;
  const render = () => {
    mockCursor = 0;
    mockDueEffects = [];
    tree = TaskBankPage();
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
      if (mounted) render();
    });
  };
  render();
}

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

// The props the page last rendered each element of `type` with.
function propsOf(type: unknown): any[] {
  const found: any[] = [];
  const visit = (node: any) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object' && node.props) {
      if (node.type === type) found.push(node.props);
      visit(node.props.children);
    }
  };
  visit(tree);
  return found;
}

const cards = () => propsOf(TaskBankCard);
const createForm = () => propsOf(TaskBankForm).find((props) => props.mode === 'create');
const editForm = () => propsOf(TaskBankForm).find((props) => props.mode === 'edit');
const templateManager = () => propsOf(TemplateManagerDialog)[0];

// ── Fake Task Bank API ───────────────────────────────────────────────────

type Row = Record<string, any>;

let taskRows: Row[] = [];
let templateRows: Row[] = [];
let createdCount = 0;
let sent: { method: string; url: string }[] = [];
// While set, a create's reply (and the row it makes) waits for releaseSaves().
let holdSaves = false;
let heldSaves: (() => void)[] = [];
let failSaves = false;
let failDeletes = false;

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Mirrors app/api/task-bank and app/api/task-bank/templates: the collection
// takes GET and POST, a row's URL takes PUT and DELETE, and 404s an unknown id.
function api(method: string, url: string, body: any) {
  const isTemplate = url.startsWith('/api/task-bank/templates');
  const base = isTemplate ? '/api/task-bank/templates' : '/api/task-bank';
  const rows = isTemplate ? templateRows : taskRows;
  const id = url.slice(base.length + 1);
  if (!id) {
    if (method === 'GET') return reply(200, rows.map((row) => ({ ...row })));
    if (failSaves) return reply(500, { error: isTemplate ? 'Failed to create template' : 'Failed to create task' });
    const now = new Date().toISOString();
    const row = { ...body, id: `${isTemplate ? 'template' : 'task'}-${++createdCount}`, createdAt: now, updatedAt: now };
    rows.push(row);
    return reply(200, { ...row });
  }
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return reply(404, { error: 'Not found' });
  if (method === 'DELETE') {
    if (failDeletes) return reply(500, { error: 'Failed to delete' });
    rows.splice(index, 1);
    return reply(200, { success: true });
  }
  rows[index] = { ...rows[index], ...body, updatedAt: new Date().toISOString() };
  return reply(200, { ...rows[index] });
}

const mockFetch = jest.fn(async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  sent.push({ method, url });
  if (method === 'POST' && holdSaves) {
    return new Promise<ReturnType<typeof reply>>((resolve) => heldSaves.push(() => resolve(api(method, url, body))));
  }
  return api(method, url, body);
});

async function releaseSaves() {
  holdSaves = false;
  heldSaves.splice(0).forEach((release) => release());
  await flush();
}

const errors = () => jest.mocked(toast.error).mock.calls.map(([message]) => message);

const stretch = { name: 'Stretch', durationSeconds: 300, color: 'green', tags: [], isOneOff: false, dueDate: null };
const reading = { name: 'Reading', durationSeconds: 1200, color: 'blue', tags: [] };

beforeAll(() => {
  (global as any).fetch = mockFetch;
  // The page listens on window for other pages' changes to the bank.
  (global as any).window = { addEventListener: () => {}, removeEventListener: () => {} };
});

afterAll(() => {
  delete (global as any).window;
});

beforeEach(async () => {
  jest.clearAllMocks();
  taskRows = [];
  templateRows = [];
  createdCount = 0;
  sent = [];
  holdSaves = true;
  heldSaves = [];
  failSaves = false;
  failDeletes = false;
  renderPage();
  await flush();
});

afterEach(() => {
  mounted = false;
});

describe('a Task Bank row deleted while it is still saving', () => {
  test('is deleted on the server once saved, and doesn’t come back', async () => {
    const adding = createForm().onSubmit(stretch);
    await flush();
    const [placeholder] = cards();
    expect(placeholder.task.name).toBe('Stretch');

    placeholder.onDelete(placeholder.task.id);
    await flush();
    expect(cards()).toEqual([]);

    await releaseSaves();
    await adding;
    await flush();

    expect(taskRows).toEqual([]);
    expect(cards()).toEqual([]);
    expect(sent).toContainEqual({ method: 'DELETE', url: '/api/task-bank/task-1' });
    expect(errors()).toEqual([]);
  });

  test('sends no delete, and shows no delete error, if the save fails', async () => {
    failSaves = true;
    const adding = createForm().onSubmit(stretch);
    await flush();
    cards()[0].onDelete(cards()[0].task.id);
    await flush();

    await releaseSaves();
    await expect(adding).rejects.toThrow('Failed to create task');
    await flush();

    expect(cards()).toEqual([]);
    expect(sent.filter((request) => request.method === 'DELETE')).toEqual([]);
    expect(errors()).toEqual(['Failed to create task']);
  });

  test('comes back under its saved id if deleting it fails', async () => {
    failDeletes = true;
    const adding = createForm().onSubmit(stretch);
    await flush();
    cards()[0].onDelete(cards()[0].task.id);
    await flush();

    await releaseSaves();
    await adding;
    await flush();

    expect(cards().map((card) => card.task.id)).toEqual(['task-1']);
    expect(errors()).toEqual(['Failed to delete task']);
  });

  test('works the same for a template', async () => {
    const adding = templateManager().onCreate(reading);
    await flush();
    const [placeholder] = templateManager().templates;
    templateManager().onDelete(placeholder.id);
    await flush();

    await releaseSaves();
    await adding;
    await flush();

    expect(templateRows).toEqual([]);
    expect(templateManager().templates).toEqual([]);
    expect(errors()).toEqual([]);
  });
});

describe('editing a row whose editor opened while it was saving', () => {
  test('edits the task it saved as', async () => {
    const adding = createForm().onSubmit(stretch);
    await flush();
    cards()[0].onEdit(cards()[0].task);
    await flush();
    await releaseSaves();
    await adding;
    await flush();

    await editForm().onSubmit({ ...stretch, name: 'Stretch longer' });
    await flush();

    expect(taskRows.map((row) => row.name)).toEqual(['Stretch longer']);
    expect(cards().map((card) => [card.task.id, card.task.name])).toEqual([['task-1', 'Stretch longer']]);
    expect(errors()).toEqual([]);
  });

  test('edits the template it saved as', async () => {
    const adding = templateManager().onCreate(reading);
    await flush();
    const [placeholder] = templateManager().templates;
    await releaseSaves();
    await adding;
    await flush();

    await templateManager().onUpdate(placeholder.id, { ...reading, name: 'Reading, slower' });
    await flush();

    expect(templateRows.map((row) => row.name)).toEqual(['Reading, slower']);
    expect(templateManager().templates.map((t: Row) => t.name)).toEqual(['Reading, slower']);
    expect(errors()).toEqual([]);
  });
});

describe('a row that has saved', () => {
  test('is deleted as before', async () => {
    holdSaves = false;
    await createForm().onSubmit(stretch);
    await flush();

    cards()[0].onDelete('task-1');
    await flush();

    expect(taskRows).toEqual([]);
    expect(cards()).toEqual([]);
    expect(jest.mocked(toast.success).mock.calls.map(([message]) => message)).toEqual(['Task added to bank', 'Task deleted']);
  });
});
