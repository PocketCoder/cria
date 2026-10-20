/**
 * Which Vikunja API generation to talk to, decided once per server URL.
 *
 * `GET /info` (identical on v1 and v2) reports the server version, for example
 * `v2.7.0-16-g58f7cf47`. Servers at or above {@link V2_MIN_VERSION} are used
 * over `/api/v2`; anything lower, or a version we cannot parse, stays on
 * `/api/v1` (deprecated in Vikunja 3.0, removed in 4.0). A persisted "Force
 * API v1" preference overrides detection.
 *
 * The detected decision is cached on `globalThis` (pinned so Vite HMR cannot
 * reset it mid-flight, see AGENTS.md) and read synchronously by the adapter in
 * `adapter.ts`, which owns every other v1/v2 difference. Until a server has
 * been probed the decision is v1, which every supported server still serves.
 * The probe itself lives in `client.ts` (`refreshApiVersion`), because it needs
 * the network layer.
 *
 * Contract: the v1/v2 section of AGENTS.md.
 */
import { useSettings } from '@/stores/settings';

export type ApiVersion = 'v1' | 'v2';

/** First Vikunja release the v2 contract was verified against (and the one
 *  Cria's settings PATCH already required). */
export const V2_MIN_VERSION = '2.7.0';

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Parse the leading `vMAJOR.MINOR.PATCH` of a server version string. */
export function parseServerVersion(raw: string | null | undefined): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Negative, zero or positive, like a sort comparator. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The decision from the server version alone (ignores the force preference). */
export function decideApiVersion(rawVersion: string | null | undefined): ApiVersion {
  const parsed = parseServerVersion(rawVersion);
  const min = parseServerVersion(V2_MIN_VERSION)!;
  return parsed && compareVersions(parsed, min) >= 0 ? 'v2' : 'v1';
}

declare global {
  var __cria_apiVersion__: Map<string, ApiVersion> | undefined;
  var __cria_apiVersionProbes__: Map<string, Promise<void>> | undefined;
}

/** Cache key: the server root without trailing slashes, case-folded. */
export function serverKey(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '').toLowerCase();
}

function detected(): Map<string, ApiVersion> {
  return (globalThis.__cria_apiVersion__ ??= new Map());
}

/** The "Force API v1" preference. Tolerates a missing or mocked store. */
export function isForceV1(): boolean {
  try {
    return useSettings.getState().forceApiV1 === true;
  } catch {
    return false;
  }
}

/** What probing found for this server, ignoring the force preference. */
export function getDetectedApiVersion(serverUrl: string): ApiVersion | undefined {
  return detected().get(serverKey(serverUrl));
}

export function setDetectedApiVersion(serverUrl: string, version: ApiVersion): void {
  detected().set(serverKey(serverUrl), version);
}

/**
 * The decision in force: v1 when forced, else the probed version, else
 * `undefined` (not probed yet). Callers that need to behave differently for a
 * server that has not been probed (the settings save tries v2 first) use this.
 */
export function getApiVersionDecision(serverUrl: string): ApiVersion | undefined {
  if (isForceV1()) return 'v1';
  return getDetectedApiVersion(serverUrl);
}

/** The version to use right now: the decision, defaulting to v1. */
export function getApiVersion(serverUrl: string): ApiVersion {
  return getApiVersionDecision(serverUrl) ?? 'v1';
}

/** Forget the cached decision for one server, or all of them. */
export function resetApiVersion(serverUrl?: string): void {
  if (serverUrl === undefined) {
    detected().clear();
    globalThis.__cria_apiVersionProbes__?.clear();
    return;
  }
  detected().delete(serverKey(serverUrl));
  globalThis.__cria_apiVersionProbes__?.delete(serverKey(serverUrl));
}

/**
 * Probe once per server and cache the result. Concurrent callers share one
 * probe. `fetchVersion` returns the server's `version` string (null if it
 * reported none); it throws when the server is unreachable, in which case
 * nothing is cached and the next call tries again.
 */
export function ensureApiVersion(
  serverUrl: string,
  fetchVersion: () => Promise<string | null>,
  opts: { force?: boolean } = {},
): Promise<void> {
  const key = serverKey(serverUrl);
  if (!opts.force && detected().has(key)) return Promise.resolve();
  const probes = (globalThis.__cria_apiVersionProbes__ ??= new Map());
  const inflight = probes.get(key);
  if (inflight) return inflight;
  const p = fetchVersion()
    .then((version) => {
      detected().set(key, decideApiVersion(version));
    })
    .finally(() => {
      probes.delete(key);
    });
  probes.set(key, p);
  return p;
}
