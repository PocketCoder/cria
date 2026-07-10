import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initSchema, clearTables } from './_helpers';
import { upsertUser, getCachedUser } from '@/db/user';
import { subscribe } from '@/db/bus';
import type { User } from '@/domain/user';

const user = (overrides: Partial<User> = {}): User => ({
  serverId: 1,
  username: 'alice',
  email: 'a@example.com',
  name: 'Alice',
  raw: { id: 1, username: 'alice', settings: { language: 'en' } },
  fetchedAt: '2026-07-10T10:00:00Z',
  defaultProjectId: null,
  language: 'en',
  timezone: 'UTC',
  weekStart: 1,
  ...overrides,
});

describe('db/user upsertUser', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('notifies on first insert and on real changes', async () => {
    let notifications = 0;
    const unsub = subscribe('user', () => notifications++);

    await upsertUser(user());
    expect(notifications).toBe(1);

    await upsertUser(user({ name: 'Alice B', fetchedAt: '2026-07-10T10:01:00Z' }));
    expect(notifications).toBe(2);
    unsub();
  });

  it('does NOT notify when only fetchedAt changed (breaks the refetch loop)', async () => {
    let notifications = 0;
    await upsertUser(user());
    const unsub = subscribe('user', () => notifications++);

    // Same user, fresher timestamp — the background refresh steady state.
    await upsertUser(user({ fetchedAt: '2026-07-10T10:05:00Z' }));
    expect(notifications).toBe(0);

    // The row still records the newer fetch.
    const cached = await getCachedUser();
    expect(cached?.fetchedAt).toBe('2026-07-10T10:05:00Z');
    unsub();
  });
});
