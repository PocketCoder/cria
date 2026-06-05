import { z } from 'zod';

export interface Bucket {
  localId: string;
  serverId: number | null;
  viewLocalId: string;
  title: string;
  position: number | null;
  limit: number;
  createdByServerId: number | null;
  updatedAt: string;
}

/** Task-bucket assignment: a task belongs to one bucket per kanban view. */
export interface TaskBucket {
  taskLocalId: string;
  viewLocalId: string;
  bucketLocalId: string;
  position: number | null;
}

/** Server response shape for GET …/buckets or the kanban endpoint's buckets. */
export const bucketResponseSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    project_view_id: z.number(),
    position: z.number().nullable().optional(),
    limit: z.number().nullable().optional(),
    created_by_id: z.number().nullable().optional(),
    created: z.string().nullable().optional(),
    updated: z.string().nullable().optional(),
  })
  .passthrough();

export type BucketResponse = z.infer<typeof bucketResponseSchema>;
