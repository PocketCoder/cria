// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

// storage.ts reads `__TAURI_INTERNALS__` and caches the keychain probe at
// module level, so each test gets a fresh module.
async function load() {
  vi.resetModules();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  return import('@/auth/storage');
}

const creds = {
  serverUrl: 'https://vk.example',
  token: 'tok',
  authMethod: 'password' as const,
  refreshToken: 'ref',
};

/** An in-memory keychain behind the three secure_* commands. */
function keychain(initial: string | null = null) {
  let slot = initial;
  invoke.mockImplementation(async (cmd: string, args?: { token: string }) => {
    if (cmd === 'secure_get_token') return slot;
    if (cmd === 'secure_set_token') slot = args!.token;
    if (cmd === 'secure_delete_token') slot = null;
  });
  return () => slot;
}

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
});

describe('credential storage', () => {
  it('keeps the whole credential in the keychain, never the token in localStorage', async () => {
    const slot = keychain();
    const s = await load();
    await s.saveCredentials(creds);
    expect(JSON.parse(slot()!)).toEqual(creds);
    expect(localStorage.getItem('cria:token/v1')).toBeNull();
    expect(localStorage.getItem('cria:refresh/v1')).toBeNull();
    expect(await s.loadCredentials()).toEqual(creds);
  });

  it('falls back to localStorage only when the store is missing (Android stub)', async () => {
    invoke.mockRejectedValue('native keychain unavailable on this platform');
    const s = await load();
    await s.saveCredentials(creds);
    expect(localStorage.getItem('cria:token/v1')).toBe('tok');
    expect(await s.loadCredentials()).toEqual(creds);
  });

  it('never writes the token to localStorage on a transient keychain error', async () => {
    invoke.mockRejectedValue(new Error('User interaction is not allowed.'));
    const s = await load();
    await expect(s.saveCredentials(creds)).rejects.toThrow();
    expect(localStorage.getItem('cria:token/v1')).toBeNull();
    expect(localStorage.getItem('cria:refresh/v1')).toBeNull();
  });

  it('treats an unreadable keychain as signed out instead of throwing', async () => {
    invoke.mockRejectedValue(new Error('keychain locked'));
    const s = await load();
    expect(await s.loadCredentials()).toBeNull();
  });

  it('upgrades a legacy bare-token slot using localStorage meta', async () => {
    const slot = keychain('bare-token');
    localStorage.setItem(
      'cria:credentials/v2',
      JSON.stringify({ serverUrl: 'https://vk.example', authMethod: 'token' }),
    );
    const s = await load();
    const got = await s.loadCredentials();
    expect(got).toEqual({ serverUrl: 'https://vk.example', token: 'bare-token', authMethod: 'token' });
    await vi.waitFor(() => expect(JSON.parse(slot()!).token).toBe('bare-token'));
  });

  it('migrates and scrubs the v1 plaintext blob', async () => {
    const slot = keychain();
    localStorage.setItem(
      'cria:credentials/v1',
      JSON.stringify({ serverUrl: 'https://vk.example', token: 'old' }),
    );
    const s = await load();
    expect((await s.loadCredentials())?.token).toBe('old');
    expect(localStorage.getItem('cria:credentials/v1')).toBeNull();
    expect(JSON.parse(slot()!).token).toBe('old');
  });

  it('clearCredentials wipes the keychain and every localStorage key', async () => {
    const slot = keychain(JSON.stringify(creds));
    localStorage.setItem('cria:credentials/v2', '{}');
    localStorage.setItem('cria:token/v1', 'x');
    const s = await load();
    await s.clearCredentials();
    expect(slot()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('isStoreMissing only matches the missing-store errors', async () => {
    const { isStoreMissing } = await load();
    expect(isStoreMissing('Command secure_get_token not found')).toBe(true);
    expect(isStoreMissing('native keychain unavailable on this platform')).toBe(true);
    expect(isStoreMissing(new Error('User canceled the operation.'))).toBe(false);
  });
});
