import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { listProjects, getProjectByLocalId, createProject, updateProject, deleteProject } from '@/db/projects';

describe('db/projects', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  describe('listProjects', () => {
    it('returns empty array when no projects exist', async () => {
      const all = await listProjects();
      expect(all).toEqual([]);
    });

    it('returns non-deleted projects ordered by position then title', async () => {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, position, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['p2', 2, 'Beta', 2048, now],
      );
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, position, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['p1', 1, 'Alpha', 1024, now],
      );
      const all = await listProjects();
      expect(all.map((p) => p.localId)).toEqual(['p1', 'p2']);
    });

    it('excludes deleted projects', async () => {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['p1', 1, 'Visible', now],
      );
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        ['p2', 2, 'Hidden', now],
      );
      const all = await listProjects();
      expect(all.map((p) => p.localId)).toEqual(['p1']);
    });

    it('maps isArchived and isFavorite from integer columns', async () => {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, is_archived, is_favorite, updated_at, dirty, deleted) VALUES (?, ?, ?, 1, 1, ?, 0, 0)`,
        ['p1', 1, 'ArchivedFav', now],
      );
      const projects = await listProjects();
      const p = projects[0]!;
      expect(p.isArchived).toBe(true);
      expect(p.isFavorite).toBe(true);
    });
  });

  describe('getProjectByLocalId', () => {
    it('returns null for unknown local_id', async () => {
      const p = await getProjectByLocalId('nonexistent');
      expect(p).toBeNull();
    });

    it('returns the project when it exists', async () => {
      const localId = await seedProject(1, 'My project');
      const p = await getProjectByLocalId(localId);
      expect(p).not.toBeNull();
      expect(p!.title).toBe('My project');
      expect(p!.serverId).toBe(1);
      expect(p!.localId).toBe(localId);
    });

    it('returns null for a deleted project', async () => {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        ['p_del', 1, 'Deleted', now],
      );
      const p = await getProjectByLocalId('p_del');
      expect(p).toBeNull();
    });
  });

  describe('createProject', () => {
    it('creates a project with a local_id and marks it dirty', async () => {
      const p = await createProject({ title: 'New project' });
      expect(p.localId).toBeTruthy();
      expect(p.title).toBe('New project');
      expect(p.serverId).toBeNull();
      const db = await getDb();
      const rows = await db.select<{ dirty: number }[]>(
        `SELECT dirty FROM projects WHERE local_id = ?`,
        [p.localId],
      );
      expect(rows[0]!.dirty).toBe(1);
    });

    it('queues an outbox entry for the create', async () => {
      const p = await createProject({ title: 'Outbox project' });
      const db = await getDb();
      const outbox = await db.select<{ entity_type: string; op: string; entity_local_id: string }[]>(
        `SELECT entity_type, op, entity_local_id FROM outbox WHERE entity_local_id = ?`,
        [p.localId],
      );
      expect(outbox.length).toBe(1);
      expect(outbox[0]!.entity_type).toBe('project');
      expect(outbox[0]!.op).toBe('create');
    });

    it('assigns auto-incrementing positions', async () => {
      const a = await createProject({ title: 'A' });
      const b = await createProject({ title: 'B' });
      expect(b.position).toBeGreaterThan(a.position!);
    });

    it('accepts description, hexColor, parentLocalId', async () => {
      const parent = await createProject({ title: 'Parent' });
      const child = await createProject({
        title: 'Child',
        description: 'A sub-project',
        hexColor: '#ff0000',
        parentLocalId: parent.localId,
      });
      expect(child.description).toBe('A sub-project');
      expect(child.hexColor).toBe('#ff0000');
      expect(child.parentLocalId).toBe(parent.localId);
    });
  });

  describe('updateProject', () => {
    it('updates title and marks dirty + outbox', async () => {
      const p = await createProject({ title: 'Original' });
      const updated = await updateProject(p.localId, { title: 'Changed' });
      expect(updated.title).toBe('Changed');
      const db = await getDb();
      const rows = await db.select<{ dirty: number }[]>(
        `SELECT dirty FROM projects WHERE local_id = ?`,
        [p.localId],
      );
      expect(rows[0]!.dirty).toBe(1);
      const outbox = await db.select<{ op: string }[]>(
        `SELECT op FROM outbox WHERE entity_local_id = ? AND op = 'update'`,
        [p.localId],
      );
      expect(outbox.length).toBe(1);
    });

    it('throws on non-existent local_id', async () => {
      await expect(updateProject('nope', { title: 'x' })).rejects.toThrow('Project not found');
    });

    it('converts isArchived/isFavorite to integers', async () => {
      const p = await createProject({ title: 'Toggle' });
      const archived = await updateProject(p.localId, { isArchived: true, isFavorite: true });
      expect(archived.isArchived).toBe(true);
      expect(archived.isFavorite).toBe(true);
    });
  });

  describe('deleteProject', () => {
    it('soft-deletes the project and its tasks', async () => {
      const p = await createProject({ title: 'To delete' });
      const db = await getDb();
      const taskId = 'task_del';
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [taskId, p.localId, 'child task', new Date().toISOString()],
      );
      await deleteProject(p.localId);
      const projRow = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM projects WHERE local_id = ?`,
        [p.localId],
      );
      expect(projRow[0]!.deleted).toBe(1);
      const taskRow = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM tasks WHERE local_id = ?`,
        [taskId],
      );
      expect(taskRow[0]!.deleted).toBe(1);
    });

    it('queues a delete outbox entry', async () => {
      const p = await createProject({ title: 'Outbox delete' });
      await deleteProject(p.localId);
      const db = await getDb();
      const outbox = await db.select<{ op: string }[]>(
        `SELECT op FROM outbox WHERE entity_local_id = ? AND op = 'delete'`,
        [p.localId],
      );
      expect(outbox.length).toBe(1);
    });

    it('is idempotent on already-deleted project', async () => {
      const p = await createProject({ title: 'Gone' });
      await deleteProject(p.localId);
      await expect(deleteProject(p.localId)).resolves.toBeUndefined();
    });
  });
});
