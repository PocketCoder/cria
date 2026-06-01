import { z } from 'zod';

/**
 * Local domain representation of the logged-in user. We keep `raw` so the
 * sync engine can re-derive anything we missed without another round-trip.
 */
export interface User {
  serverId: number;
  username: string;
  email: string | null;
  name: string | null;
  raw: unknown;
  /** ISO 8601 timestamp when we last fetched the user from the server. */
  fetchedAt: string;
  /** The project new tasks default to (per user settings on the server). */
  defaultProjectId: number | null;
}

/**
 * Schema for Vikunja's GET /api/v1/user response. Permissive: we accept
 * unknown extra fields and tolerate missing optional ones.
 */
export const userResponseSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    email: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

export type UserResponse = z.infer<typeof userResponseSchema>;

export function userFromResponse(payload: unknown): User {
  const parsed = userResponseSchema.parse(payload);
  const raw = payload as Record<string, unknown>;
  const settings = raw.settings as Record<string, unknown> | undefined;
  return {
    serverId: parsed.id,
    username: parsed.username,
    email: parsed.email ?? null,
    name: parsed.name ?? null,
    raw: payload,
    fetchedAt: new Date().toISOString(),
    defaultProjectId: (settings?.default_project_id as number | undefined) ?? null,
  };
}
