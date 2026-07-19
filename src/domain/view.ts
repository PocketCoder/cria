import { z } from 'zod';

export type ViewKind = 'list' | 'gantt' | 'table' | 'kanban';

export type BucketConfigMode = 'none' | 'manual' | 'filter';

export interface ProjectView {
  localId: string;
  serverId: number | null;
  projectLocalId: string;
  title: string;
  viewKind: ViewKind;
  position: number | null;
  filter: string | null;
  bucketConfigurationMode: BucketConfigMode;
  bucketConfiguration: string | null;
  defaultBucketServerId: number | null;
  doneBucketServerId: number | null;
  updatedAt: string;
}

/**
 * A view's stored filter, extracted from the TaskCollection JSON the server
 * puts in `project_views.filter` ({"filter": "...", "filter_include_nulls": …}).
 * Bare strings (older payloads / hand-written rows) are treated as the query
 * itself. Returns null when the view has no usable filter.
 */
export function viewFilterParams(
  view: ProjectView,
): { filter: string; includeNulls: boolean } | null {
  if (!view.filter) return null;
  let filter = view.filter;
  let includeNulls = false;
  if (filter.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(filter) as {
        filter?: unknown;
        filter_include_nulls?: unknown;
      };
      filter = typeof parsed.filter === 'string' ? parsed.filter : '';
      includeNulls = parsed.filter_include_nulls === true;
    } catch {
      return null;
    }
  }
  return filter.trim() ? { filter, includeNulls } : null;
}

export const viewResponseSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    project_id: z.number(),
    view_kind: z.enum(['list', 'gantt', 'table', 'kanban']),
    position: z.number().nullable().optional(),
    filter: z.unknown().nullable().optional(),
    bucket_configuration_mode: z.enum(['none', 'manual', 'filter']).optional(),
    bucket_configuration: z
      .array(z.unknown())
      .nullable()
      .optional(),
    default_bucket_id: z.number().nullable().optional(),
    done_bucket_id: z.number().nullable().optional(),
    created: z.string().nullable().optional(),
    updated: z.string().nullable().optional(),
  })
  .passthrough();

export type ViewResponse = z.infer<typeof viewResponseSchema>;
