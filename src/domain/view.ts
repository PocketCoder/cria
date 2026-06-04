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
