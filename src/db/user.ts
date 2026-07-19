import type { User } from '@/domain/user';
import { getDb, exec } from './index';
import { notify } from './bus';

interface UserRow {
  id: number;
  server_id: number;
  username: string;
  email: string | null;
  name: string | null;
  raw: string;
  fetched_at: string;
}

export async function getCachedUser(): Promise<User | null> {
  const db = await getDb();
  const rows = await db.select<UserRow[]>(`SELECT * FROM user WHERE id = 1`);
  const row = rows[0];
  if (!row) return null;
  const raw = JSON.parse(row.raw) as Record<string, unknown>;
  const settings = raw.settings as Record<string, unknown> | undefined;
  return {
    serverId: row.server_id,
    username: row.username,
    email: row.email,
    name: row.name,
    raw,
    fetchedAt: row.fetched_at,
    defaultProjectId: (settings?.default_project_id as number | undefined) ?? null,
    language: (settings?.language as string | undefined) ?? 'en',
    timezone: (settings?.timezone as string | undefined) ?? 'UTC',
    weekStart: (settings?.week_start as number | undefined) ?? 1,
  };
}

export async function upsertUser(user: User): Promise<void> {
  const rawJson = JSON.stringify(user.raw);

  // Only notify when something other than fetched_at changed. The 'user'
  // bus topic invalidates useCurrentUser, whose refetch calls upsertUser
  // again — notifying on every timestamp-only write turned that into a
  // self-sustaining request loop (~90 req/s when the server failed fast).
  const db = await getDb();
  const existing = await db.select<
    { server_id: number; username: string; email: string | null; name: string | null; raw: string }[]
  >(`SELECT server_id, username, email, name, raw FROM user WHERE id = 1 LIMIT 1`);
  const prev = existing[0];
  const changed =
    !prev ||
    prev.server_id !== user.serverId ||
    prev.username !== user.username ||
    prev.email !== user.email ||
    prev.name !== user.name ||
    prev.raw !== rawJson;

  await exec(
    `INSERT INTO user (id, server_id, username, email, name, raw, fetched_at)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       server_id  = excluded.server_id,
       username   = excluded.username,
       email      = excluded.email,
       name       = excluded.name,
       raw        = excluded.raw,
       fetched_at = excluded.fetched_at`,
    [
      user.serverId,
      user.username,
      user.email,
      user.name,
      rawJson,
      user.fetchedAt,
    ],
  );
  if (changed) notify('user');
}

export async function clearUser(): Promise<void> {
  await exec(`DELETE FROM user`);
  notify('user');
}
