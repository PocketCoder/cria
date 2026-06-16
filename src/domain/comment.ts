import { z } from 'zod';

const reactionUserSchema = z.object({
  id: z.number().optional(),
  name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
});

export type ReactionUser = z.infer<typeof reactionUserSchema>;

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
    reactions: z.record(z.string(), z.array(reactionUserSchema)).optional(),
  })
  .passthrough();

export type CommentResponse = z.infer<typeof commentResponseSchema>;

export type ReactionMap = Record<string, ReactionUser[]>;

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
  reactions: ReactionMap | null;
}
