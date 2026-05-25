import type { User } from '@/domain/user';
import { getDb } from './index';
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
  return {
    serverId: row.server_id,
    username: row.username,
    email: row.email,
    name: row.name,
    raw: JSON.parse(row.raw) as unknown,
    fetchedAt: row.fetched_at,
  };
}

export async function upsertUser(user: User): Promise<void> {
  const db = await getDb();
  await db.execute(
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
      JSON.stringify(user.raw),
      user.fetchedAt,
    ],
  );
  notify('user');
}

export async function clearUser(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM user`);
  notify('user');
}
