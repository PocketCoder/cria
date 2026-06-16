import { z } from 'zod';

export const commentResponseSchema = z
  .object({
    id: z.number(),
    comment: z.string().nullable().optional(),
    author: z
      .object({
        id: z.number().nullable().optional(),
        name: z.string().nullable().optional(),
        username: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    created: z.string().nullable().optional(),
    updated: z.string().nullable().optional(),
  })
  .passthrough();

export type CommentResponse = z.infer<typeof commentResponseSchema>;

export interface TaskComment {
  localId: string;
  serverId: number;
  taskLocalId: string;
  comment: string;
  authorName: string | null;
  authorServerId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  read: boolean;
  syncedAt: string | null;
  dirty: boolean;
  deleted: boolean;
}
