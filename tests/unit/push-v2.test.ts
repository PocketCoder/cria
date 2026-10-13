/**
 * Every outbox executor, the subscription calls and a paginated pull, run
 * through the real API layer (createApiClient -> adapter -> platformFetch ->
 * fetch) against a fake Vikunja that models both API generations strictly: a
 * request with the wrong verb for the generation is a 405, so a passing test
 * proves the adapter picked the right verb, path, body and response shape.
 *
 * v1: PUT creates, POST updates, bare-array lists, `{ code, message }` errors,
 * 200 deletes. v2: POST creates, PUT replaces, PATCH merges
 * (`application/merge-patch+json`), `{ items, total_pages }` lists,
 * problem+json errors, 204 deletes, a `$schema` field on every body.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

type Json = Record<string, unknown>;

vi.mock('@/auth/store', () => ({
  useAuth: {
    getState: () => ({
      status: { kind: 'authenticated', credentials: { serverUrl: 'https://vk.example', token: 'tk', authMethod: 'token' } },
      signOut: vi.fn(),
    }),
  },
  getAuthSnapshot: () => ({ serverUrl: 'https://vk.example', token: 'tk' }),
}));
vi.mock('@/db/user', () => ({
  getCachedUser: vi.fn(async () => ({ serverId: 1, username: 'jake', name: 'Jake' })),
}));

import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { createApiClient } from '@/api/client';
import { drainOutbox, subscribeToTask, unsubscribeFromTask } from '@/sync/push';
import { pullProjects } from '@/sync/pull';
import { createProject, updateProject, deleteProject } from '@/db/projects';
import { createLabel, updateLabel, deleteLabel } from '@/db/labels';
import { createTask, updateTask, deleteTask } from '@/db/tasks';
import { createComment, updateComment, deleteComment } from '@/db/comments';
import { setDetectedApiVersion, resetApiVersion, type ApiVersion } from '@/api/apiVersion';
import { _resetResilience } from '@/api/resilience';
import { markNotificationRead } from '@/api/notifications';
import { renameTeam } from '@/api/teams';

const NO_DATE = '0001-01-01T00:00:00Z';

interface Call {
  method: string;
  path: string;
  contentType: string | null;
  body: Json | null;
}

class FakeVikunja {
  calls: Call[] = [];
  projects = new Map<number, Json>();
  labels = new Map<number, Json>();
  tasks = new Map<number, Json>();
  comments = new Map<number, Json>();
  teams = new Map<number, Json>();
  taskLabels: [number, number][] = [];
  moves: Json[] = [];
  subscriptions = new Set<string>();
  notificationsRead: Json[] = [];
  private nextId = 100;

  constructor(readonly version: ApiVersion) {}

  private out(body: unknown, status = 200): Response {
    const v2 = this.version === 'v2' && body && typeof body === 'object' && !Array.isArray(body);
    return new Response(status === 204 ? null : JSON.stringify(v2 ? { $schema: 'x', ...(body as Json) } : body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private fail(status: number, code: number, message: string): Response {
    if (this.version === 'v1') {
      return new Response(JSON.stringify({ code, message }), { status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ title: 'Error', status, detail: message, code }), {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }

  private del(store: Map<number, Json>, id: number): Response {
    if (!store.has(id)) return this.fail(404, 4002, 'does not exist');
    store.delete(id);
    return this.version === 'v1' ? this.out({ message: 'Successfully deleted.' }) : this.out(null, 204);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(req ? req.headers : init?.headers);
    const text = req ? await req.text() : typeof init?.body === 'string' ? init.body : '';
    const body = text ? (JSON.parse(text) as Json) : null;
    this.calls.push({ method, path: url.pathname, contentType: headers.get('content-type'), body });

    const prefix = `/api/${this.version}`;
    if (!url.pathname.startsWith(prefix + '/')) return this.fail(404, 404, 'no such API');
    const path = url.pathname.slice(prefix.length);
    const create = this.version === 'v1' ? 'PUT' : 'POST';
    const replace = this.version === 'v1' ? 'POST' : 'PUT';
    const m = (re: RegExp) => re.exec(path);
    let g: RegExpExecArray | null;

    // Projects and labels: the same CRUD shape, so one helper.
    const crud = (store: Map<number, Json>, base: string, updateVerb: string, fill: Json = {}): Response | null => {
      if (path === base && method === create) {
        const id = this.nextId++;
        const row = { id, ...fill, ...body, updated: '2030-01-01T00:00:00Z' };
        store.set(id, row);
        return this.out(row, this.version === 'v2' ? 201 : 200);
      }
      const one = new RegExp(`^${base}/(\\d+)$`).exec(path);
      if (!one) return null;
      const id = Number(one[1]);
      const current = store.get(id);
      if (method === 'GET') return current ? this.out(current) : this.fail(404, 4002, 'does not exist');
      if (method === 'DELETE') return this.del(store, id);
      if (!current) return this.fail(404, 4002, 'does not exist');
      if (method === updateVerb) {
        // Full replace: whatever the body omits is gone (identifier included).
        const row = { id, ...body, updated: '2030-01-02T00:00:00Z' };
        store.set(id, row);
        return this.out(row);
      }
      if (method === 'PATCH' && this.version === 'v2') {
        if (headers.get('content-type') !== 'application/merge-patch+json') return this.fail(415, 0, 'wrong media type');
        const row = { ...current, ...body, updated: '2030-01-03T00:00:00Z' };
        store.set(id, row);
        return this.out(row);
      }
      return this.fail(405, 0, `method ${method} not allowed on ${path}`);
    };

    if ((g = m(/^\/projects\/(\d+)\/tasks$/)) && method === create) {
      const id = this.nextId++;
      const row = { id, project_id: Number(g[1]), ...body, updated: '2030-01-01T00:00:00Z' };
      this.tasks.set(id, row);
      return this.out(row, this.version === 'v2' ? 201 : 200);
    }
    if (m(/^\/tasks\/(\d+)\/comments$/) && method === create) {
      const id = this.nextId++;
      const row = { id, ...body, updated: '2030-01-01T00:00:00Z' };
      this.comments.set(id, row);
      return this.out(row, this.version === 'v2' ? 201 : 200);
    }
    if ((g = m(/^\/tasks\/(\d+)\/comments\/(\d+)$/))) {
      const id = Number(g[2]);
      if (method === 'DELETE') return this.del(this.comments, id);
      if (method === replace) {
        this.comments.set(id, { id, ...body });
        return this.out(this.comments.get(id));
      }
    }
    if ((g = m(/^\/tasks\/(\d+)\/labels$/)) && method === create) {
      this.taskLabels.push([Number(g[1]), Number((body as Json).label_id)]);
      return this.out(body, this.version === 'v2' ? 201 : 200);
    }
    if (m(/^\/projects\/\d+\/views\/\d+\/buckets\/\d+\/tasks$/) && method === replace) {
      this.moves.push(body as Json);
      return this.out(body);
    }
    if ((g = m(/^\/subscriptions\/task\/(\d+)$/))) {
      if (method === create) {
        this.subscriptions.add(g[1]!);
        return this.out({ entity: 'task' }, this.version === 'v2' ? 201 : 200);
      }
      if (method === 'DELETE') {
        this.subscriptions.delete(g[1]!);
        return this.version === 'v1' ? this.out({ message: 'ok' }) : this.out(null, 204);
      }
    }
    if ((g = m(/^\/notifications\/(\d+)$/)) && method === replace) {
      this.notificationsRead.push(body ?? {});
      return this.out({ id: Number(g[1]) });
    }
    if (path === '/projects' && method === 'GET') {
      const all = [...this.projects.values()];
      // 2 per page so a handful of projects needs several pages.
      const page = Number(url.searchParams.get('page') ?? 1);
      const slice = all.slice((page - 1) * 2, page * 2);
      if (this.version === 'v1') {
        return new Response(JSON.stringify(slice), {
          headers: { 'Content-Type': 'application/json', 'x-pagination-total-pages': String(Math.ceil(all.length / 2)) },
        });
      }
      return this.out({ items: slice, page, per_page: 2, total: all.length, total_pages: Math.ceil(all.length / 2) });
    }
    const hit = crud(this.projects, '/projects', replace) ?? crud(this.labels, '/labels', replace);
    if (hit) return hit;
    if ((g = m(/^\/tasks\/(\d+)$/))) {
      const id = Number(g[1]);
      const current = this.tasks.get(id);
      if (!current) return this.fail(404, 4002, 'does not exist');
      if (method === 'GET') return this.out(current);
      if (method === 'DELETE') return this.del(this.tasks, id);
      if (method === replace) {
        this.tasks.set(id, { id, ...body });
        return this.out(this.tasks.get(id));
      }
      if (method === 'PATCH' && this.version === 'v2') {
        if (headers.get('content-type') !== 'application/merge-patch+json') return this.fail(415, 0, 'wrong media type');
        this.tasks.set(id, { ...current, ...body });
        return this.out(this.tasks.get(id));
      }
    }
    if ((g = m(/^\/teams\/(\d+)$/))) {
      const id = Number(g[1]);
      const current = this.teams.get(id)!;
      if (method === replace) {
        this.teams.set(id, { id, ...body });
        return this.out(this.teams.get(id));
      }
      if (method === 'PATCH' && this.version === 'v2') {
        this.teams.set(id, { ...current, ...body });
        return this.out(this.teams.get(id));
      }
    }
    return this.fail(405, 0, `method ${method} not allowed on ${path}`);
  };

  /** Methods + paths of the writes the client sent, without the /api/vN prefix. */
  writes(): string[] {
    return this.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path.replace(/^\/api\/v\d/, '')}`);
  }
}

async function sql<T>(q: string, params: unknown[] = []): Promise<T[]> {
  return (await getDb()).select<T[]>(q, params);
}

describe.each<ApiVersion>(['v1', 'v2'])('outbox executors against a %s server', (version) => {
  let server: FakeVikunja;
  const v2 = version === 'v2';

  beforeAll(initSchema);
  beforeEach(async () => {
    await clearTables();
    _resetResilience();
    resetApiVersion();
    setDetectedApiVersion('https://vk.example', version);
    server = new FakeVikunja(version);
    vi.stubGlobal('fetch', server.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const drain = () => drainOutbox(createApiClient());
  const outboxCount = async () => (await sql<{ n: number }>('SELECT COUNT(*) AS n FROM outbox'))[0]!.n;

  it('projects: create, update and delete', async () => {
    const p = await createProject({ title: 'Home' });
    await drain();
    const [row] = await sql<{ server_id: number }>('SELECT server_id FROM projects WHERE local_id = ?', [p.localId]);
    expect(row!.server_id).toBe(100);
    expect(server.writes()).toEqual([v2 ? 'POST /projects' : 'PUT /projects']);

    // The server owns an identifier Cria does not track.
    server.projects.set(100, { ...server.projects.get(100)!, identifier: 'HOME' });
    server.calls = [];
    await updateProject(p.localId, { title: 'Home 2', description: null });
    await drain();
    expect(server.projects.get(100)!.title).toBe('Home 2');
    if (v2) {
      // A partial update is a merge-patch, so the identifier survives (a PUT would reset it).
      expect(server.writes()).toEqual(['PATCH /projects/100']);
      expect(server.calls.at(-1)!.contentType).toBe('application/merge-patch+json');
      expect(server.projects.get(100)!.identifier).toBe('HOME');
      // A cleared field is spelled out; an omitted key would mean "keep".
      expect(server.calls.at(-1)!.body).toMatchObject({ title: 'Home 2', description: '', hex_color: '', parent_project_id: 0, is_archived: false });
    } else {
      expect(server.writes()).toEqual(['POST /projects/100']);
    }

    server.calls = [];
    await deleteProject(p.localId);
    await drain();
    expect(server.writes()).toEqual(['DELETE /projects/100']);
    expect(await outboxCount()).toBe(0);
  });

  it('labels: create, update (POST on v1, PUT on v2) and delete', async () => {
    const l = await createLabel({ title: 'urgent', hexColor: '#ff0000' });
    await drain();
    expect(server.writes()).toEqual([v2 ? 'POST /labels' : 'PUT /labels']);
    expect(server.labels.get(100)).toMatchObject({ title: 'urgent', hex_color: 'ff0000' });

    server.calls = [];
    await updateLabel(l.localId, { title: 'urgent!' });
    await drain();
    expect(server.writes()).toEqual([v2 ? 'PUT /labels/100' : 'POST /labels/100']);
    expect(server.labels.get(100)).toMatchObject({ title: 'urgent!', hex_color: 'ff0000' });

    server.calls = [];
    await deleteLabel(l.localId);
    await drain();
    expect(server.writes()).toEqual(['DELETE /labels/100']);
    expect(await outboxCount()).toBe(0);
  });

  it('tasks: create, update with wire quirks, label link, subscribe and delete', async () => {
    const p = await createProject({ title: 'Home' });
    await drain();
    const l = await createLabel({ title: 'a' });
    await drain();
    const t = await createTask({ title: 'Buy milk', projectLocalId: p.localId, dueDate: '2030-05-01T09:00:00+00:00', hexColor: '#00ff00' });
    await drain();
    const [trow] = await sql<{ server_id: number }>('SELECT server_id FROM tasks WHERE local_id = ?', [t.localId]);
    const sid = trow!.server_id;
    expect(server.writes().at(-1)).toBe(v2 ? 'POST /projects/100/tasks' : 'PUT /projects/100/tasks');
    expect(server.tasks.get(sid)).toMatchObject({ hex_color: '00ff00', is_favorite: false, repeat_after: 0 });

    // Untracked server field + clear the due date locally.
    server.tasks.set(sid, { ...server.tasks.get(sid)!, cover_image_attachment_id: 42 });
    server.calls = [];
    await updateTask(t.localId, { title: 'Buy oat milk', dueDate: null });
    await drain();
    if (v2) {
      expect(server.writes()).toEqual([`PATCH /tasks/${sid}`]);
      expect(server.calls.at(-1)!.contentType).toBe('application/merge-patch+json');
      const stored = server.tasks.get(sid)!;
      expect(stored.cover_image_attachment_id).toBe(42);
      expect(stored.due_date).toBe(NO_DATE);
      expect(stored).toMatchObject({ title: 'Buy oat milk', hex_color: '00ff00', is_favorite: false, repeat_after: 0, repeat_mode: 0 });
    } else {
      expect(server.writes()).toEqual([`POST /tasks/${sid}`]);
      expect(server.calls.at(-1)!.body).toMatchObject({ title: 'Buy oat milk', is_favorite: false });
      expect(server.calls.at(-1)!.body).not.toHaveProperty('due_date');
    }
    const [after] = await sql<{ dirty: number }>('SELECT dirty FROM tasks WHERE local_id = ?', [t.localId]);
    expect(after!.dirty).toBe(0);

    // Label link: PUT on v1, POST on v2.
    const db = await getDb();
    await db.execute(`INSERT OR IGNORE INTO task_labels (task_local_id, label_local_id) VALUES (?, ?)`, [t.localId, l.localId]);
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES ('task_label', ?, 'add', ?, ?)`,
      [t.localId, JSON.stringify({ labelLocalId: l.localId }), new Date().toISOString()],
    );
    server.calls = [];
    await drain();
    expect(server.writes()).toEqual([v2 ? `POST /tasks/${sid}/labels` : `PUT /tasks/${sid}/labels`]);
    expect(server.taskLabels).toEqual([[sid, 101]]);

    server.calls = [];
    await subscribeToTask(sid, t.localId, createApiClient());
    expect(server.writes()).toEqual([v2 ? `POST /subscriptions/task/${sid}` : `PUT /subscriptions/task/${sid}`]);
    await unsubscribeFromTask(sid, t.localId, createApiClient());
    expect(server.subscriptions.size).toBe(0);

    server.calls = [];
    await deleteTask(t.localId);
    await drain();
    expect(server.writes()).toEqual([`DELETE /tasks/${sid}`]);
    expect(await outboxCount()).toBe(0);
  });

  it('comments: create, update and delete', async () => {
    const p = await createProject({ title: 'Home' });
    await drain();
    const t = await createTask({ title: 'T', projectLocalId: p.localId });
    await drain();
    const [trow] = await sql<{ server_id: number }>('SELECT server_id FROM tasks WHERE local_id = ?', [t.localId]);
    const sid = trow!.server_id;

    server.calls = [];
    await createComment(t.localId, '<p>hi</p>');
    await drain();
    expect(server.writes()).toEqual([v2 ? `POST /tasks/${sid}/comments` : `PUT /tasks/${sid}/comments`]);
    const [c] = await sql<{ local_id: string; server_id: number }>('SELECT local_id, server_id FROM task_comments');
    expect(c!.server_id).toBe(102);

    server.calls = [];
    await updateComment(c!.local_id, '<p>hello</p>');
    await drain();
    expect(server.writes()).toEqual([`${v2 ? 'PUT' : 'POST'} /tasks/${sid}/comments/102`]);
    expect(server.comments.get(102)).toMatchObject({ comment: '<p>hello</p>' });

    server.calls = [];
    await deleteComment(c!.local_id);
    await drain();
    expect(server.writes()).toEqual([`DELETE /tasks/${sid}/comments/102`]);
    expect(await outboxCount()).toBe(0);
  });

  it('kanban: moving a task into a bucket is a POST on v1 and a PUT on v2, same path', async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.execute(`INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES ('p', 7, 'P', ?, 0, 0)`, [now]);
    await db.execute(
      `INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, updated_at) VALUES ('v', 8, 'p', 'Board', 'kanban', ?)`,
      [now],
    );
    await db.execute(`INSERT INTO buckets (local_id, server_id, view_local_id, title, updated_at) VALUES ('b', 9, 'v', 'Doing', ?)`, [now]);
    await db.execute(`INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES ('t', 'p', 5, 'T', ?, 0, 0)`, [now]);
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES ('task_bucket', 't', 'update', ?, ?)`,
      [JSON.stringify({ view_local_id: 'v', bucket_local_id: 'b' }), now],
    );
    await drain();
    expect(server.writes()).toEqual([`${v2 ? 'PUT' : 'POST'} /projects/7/views/8/buckets/9/tasks`]);
    expect(server.moves[0]).toMatchObject({ task_id: 5 });
    expect(await outboxCount()).toBe(0);
  });

  it('tolerates a 404 on delete (already gone) with either error shape', async () => {
    const l = await createLabel({ title: 'gone' });
    await drain();
    server.labels.clear();
    await deleteLabel(l.localId);
    await drain();
    expect(await outboxCount()).toBe(0);
    expect(await sql('SELECT 1 FROM outbox_dead_letter')).toHaveLength(0);
  });

  it('pulls every page of a list (header on v1, envelope on v2)', async () => {
    for (let i = 1; i <= 5; i++) server.projects.set(i, { id: i, title: `P${i}`, created: '2020-01-01T00:00:00Z', updated: '2020-01-01T00:00:00Z' });
    const n = await pullProjects(createApiClient());
    expect(n).toBe(5);
    expect(server.calls.filter((c) => c.method === 'GET').length).toBe(3);
    expect(await sql('SELECT 1 FROM projects')).toHaveLength(5);
  });

  it('marks a notification read (v2 PUT needs the new state in the body)', async () => {
    await markNotificationRead(8, createApiClient());
    expect(server.writes()).toEqual([`${v2 ? 'PUT' : 'POST'} /notifications/8`]);
    expect(server.notificationsRead[0]).toEqual(v2 ? { read: true } : {});
  });

  it('renames a team without clobbering the rest (PATCH on v2)', async () => {
    server.teams.set(3, { id: 3, name: 'Old', description: 'keep me', is_public: true });
    await renameTeam(3, 'New', createApiClient());
    if (v2) {
      expect(server.writes()).toEqual(['PATCH /teams/3']);
      expect(server.teams.get(3)).toMatchObject({ name: 'New', description: 'keep me', is_public: true });
    } else {
      expect(server.writes()).toEqual(['POST /teams/3']);
    }
  });
});

describe('a v2 server that has no PATCH for a route', () => {
  beforeAll(initSchema);
  it('throws instead of sending a partial body as a full-replace PUT', async () => {
    await clearTables();
    _resetResilience();
    resetApiVersion();
    setDetectedApiVersion('https://vk.example', 'v2');
    const server = new FakeVikunja('v2');
    const base = server.fetch;
    server.teams.set(3, { id: 3, name: 'Old' });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
      if (method === 'PATCH') {
        return new Response(JSON.stringify({ title: 'Method Not Allowed', status: 405 }), {
          status: 405,
          headers: { 'Content-Type': 'application/problem+json' },
        });
      }
      return base(input, init);
    });
    await expect(renameTeam(3, 'New', createApiClient())).rejects.toMatchObject({ status: 405 });
    expect(server.writes()).toEqual([]);
    expect(server.teams.get(3)).toMatchObject({ name: 'Old' });
    vi.unstubAllGlobals();
  });
});
