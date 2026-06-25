import { z } from 'zod';

/**
 * Local domain representation of a Vikunja project. `localId` is a
 * client-generated UUID that stays stable across sync; `serverId` is null
 * until the project has been confirmed-created on the server (see SPEC §4.2).
 *
 * For M1 (read-only sync) every project we see comes *from* the server, so
 * `serverId` will always be set, but the type permits null so M2 can drop
 * locally-created rows in here without a re-shape.
 */
export interface Project {
  localId: string;
  serverId: number | null;
  title: string;
  description: string | null;
  identifier: string | null;
  parentLocalId: string | null;
  hexColor: string | null;
  isArchived: boolean;
  isFavorite: boolean;
  position: number | null;
  updatedAt: string;
}

/**
 * Schema for the per-project payload returned by /projects et al. Permissive
 * (passthrough) so the sync engine can stash the raw payload alongside the
 * normalised one for conflict detection later.
 */
export const projectResponseSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullable().optional(),
    identifier: z.string().nullable().optional(),
    parent_project_id: z.number().nullable().optional(),
    hex_color: z.string().nullable().optional(),
    is_archived: z.boolean().nullable().optional(),
    is_favorite: z.boolean().nullable().optional(),
    position: z.number().nullable().optional(),
    updated: z.string().nullable().optional(),
  })
  .passthrough();

export type ProjectResponse = z.infer<typeof projectResponseSchema>;
