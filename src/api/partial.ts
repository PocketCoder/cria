/**
 * Partial updates, version-aware. Callers of a genuinely partial update (a
 * task or project row built from the fields Cria tracks, a team rename) call
 * {@link updatePartial} with the v1-shaped call and the merge-patch that means
 * the same thing:
 *
 * - v1: the v1-shaped call (`POST`, which only writes the listed columns).
 * - v2: `PATCH` with `application/merge-patch+json`. v2's `PUT` is a full
 *   replace, so it is never used for a body that leaves fields out; the patch
 *   must therefore spell out a cleared field (an empty string, 0, or the zero
 *   date) because an omitted key means "keep the server's value".
 *
 * A v2 server with no PATCH for the route (404/405/501) is an error, never a
 * fallback to the v2 `PUT`: that is a full replace and would wipe every field
 * the partial body leaves out. (v1 has no such fallback to make: it always
 * uses the v1-shaped call.)
 */
import { getAuthSnapshot } from '@/auth/store';
import { sendMergePatch, MERGE_PATCH } from './adapter';
import { getApiVersion } from './apiVersion';
import { ApiError } from './errors';
import type { ApiClient } from './client';

/** True when calls to the signed-in server currently go to /api/v2. */
export function usesApiV2(): boolean {
  const { serverUrl } = getAuthSnapshot();
  return !!serverUrl && getApiVersion(serverUrl) === 'v2';
}

type Resource = Record<string, unknown>;

/**
 * @param path - the v1 path with ids filled in, e.g. `/tasks/12`.
 * @param patch - the merge-patch body (v2 only).
 * @param v1 - the v1-shaped typed call; its result is returned on v1.
 */
export async function updatePartial(
  client: ApiClient,
  path: string,
  patch: Resource,
  v1: () => Promise<unknown>,
): Promise<Resource | null> {
  if (usesApiV2()) {
    // Not in the generated v1 paths (v1 has no PATCH), hence the cast.
    const request = (client as unknown as {
      request: (method: string, url: string, init: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
    }).request;
    const out = await sendMergePatch(() =>
      request.call(client, 'PATCH', path, {
        body: patch,
        headers: { 'Content-Type': MERGE_PATCH, Accept: 'application/json' },
      }),
    );
    if (out === 'unavailable') {
      throw new ApiError(405, null, `PATCH ${path} is not available on this server`, false);
    }
    return out;
  }
  return ((await v1()) as Resource | undefined) ?? null;
}
