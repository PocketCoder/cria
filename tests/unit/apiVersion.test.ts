import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  V2_MIN_VERSION,
  compareVersions,
  decideApiVersion,
  ensureApiVersion,
  getApiVersion,
  getApiVersionDecision,
  parseServerVersion,
  resetApiVersion,
  setDetectedApiVersion,
} from '@/api/apiVersion';
import { useSettings } from '@/stores/settings';

beforeEach(() => {
  resetApiVersion();
  useSettings.setState({ forceApiV1: false });
});

describe('parseServerVersion', () => {
  it('reads the leading vMAJOR.MINOR.PATCH', () => {
    expect(parseServerVersion('v2.7.0-16-g58f7cf47')).toEqual({ major: 2, minor: 7, patch: 0 });
    expect(parseServerVersion('2.6.9')).toEqual({ major: 2, minor: 6, patch: 9 });
    expect(parseServerVersion('  v10.0.1+meta')).toEqual({ major: 10, minor: 0, patch: 1 });
  });
  it('returns null for anything else', () => {
    for (const v of [null, undefined, '', 'dev', 'v2.7', 'unstable', '?']) {
      expect(parseServerVersion(v)).toBeNull();
    }
  });
});

describe('compareVersions / decideApiVersion', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions({ major: 2, minor: 10, patch: 0 }, { major: 2, minor: 9, patch: 9 })).toBeGreaterThan(0);
    expect(compareVersions({ major: 2, minor: 7, patch: 0 }, { major: 2, minor: 7, patch: 0 })).toBe(0);
  });
  it('uses v2 from the minimum version up', () => {
    expect(V2_MIN_VERSION).toBe('2.7.0');
    expect(decideApiVersion('v2.7.0')).toBe('v2');
    expect(decideApiVersion('v2.7.0-16-g58f7cf47')).toBe('v2');
    expect(decideApiVersion('v2.10.1')).toBe('v2');
    expect(decideApiVersion('v3.0.0')).toBe('v2');
  });
  it('stays on v1 below it, or when the version is unreadable', () => {
    expect(decideApiVersion('v2.6.9')).toBe('v1');
    expect(decideApiVersion('v0.24.6')).toBe('v1');
    expect(decideApiVersion('dev')).toBe('v1');
    expect(decideApiVersion(null)).toBe('v1');
  });
});

describe('per-server decision cache', () => {
  it('defaults to v1 and reports "unknown" until probed', () => {
    expect(getApiVersion('https://a.example')).toBe('v1');
    expect(getApiVersionDecision('https://a.example')).toBeUndefined();
  });
  it('is keyed by server, ignoring case and trailing slashes', () => {
    setDetectedApiVersion('https://A.example/', 'v2');
    expect(getApiVersion('https://a.example')).toBe('v2');
    expect(getApiVersion('https://b.example')).toBe('v1');
  });
  it('Force API v1 overrides a v2 detection, and un-forcing restores it', () => {
    setDetectedApiVersion('https://a.example', 'v2');
    useSettings.setState({ forceApiV1: true });
    expect(getApiVersion('https://a.example')).toBe('v1');
    expect(getApiVersionDecision('https://a.example')).toBe('v1');
    useSettings.setState({ forceApiV1: false });
    expect(getApiVersion('https://a.example')).toBe('v2');
  });
  it('lives on globalThis so an HMR reload keeps it', () => {
    setDetectedApiVersion('https://a.example', 'v2');
    expect(globalThis.__cria_apiVersion__?.get('https://a.example')).toBe('v2');
  });
});

describe('ensureApiVersion', () => {
  it('probes once, caches, and shares an in-flight probe', async () => {
    const probe = vi.fn(async () => 'v2.7.0');
    await Promise.all([
      ensureApiVersion('https://a.example', probe),
      ensureApiVersion('https://a.example', probe),
    ]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(getApiVersion('https://a.example')).toBe('v2');
    await ensureApiVersion('https://a.example', probe);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('re-probes when forced (sign-in, server change) and follows a downgrade', async () => {
    await ensureApiVersion('https://a.example', async () => 'v2.7.0');
    await ensureApiVersion('https://a.example', async () => 'v2.6.0', { force: true });
    expect(getApiVersion('https://a.example')).toBe('v1');
  });
  it('caches nothing when the server is unreachable', async () => {
    await expect(
      ensureApiVersion('https://a.example', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(getApiVersionDecision('https://a.example')).toBeUndefined();
    await ensureApiVersion('https://a.example', async () => 'v2.8.0');
    expect(getApiVersion('https://a.example')).toBe('v2');
  });
});
