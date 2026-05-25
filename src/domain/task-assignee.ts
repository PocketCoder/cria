import { z } from 'zod';

export interface TaskAssignee {
  taskLocalId: string;
  userServerId: number;
  username: string | null;
}

export const assigneeResponseSchema = z.object({
  id: z.number(),
  username: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
}).passthrough();

export type AssigneeResponse = z.infer<typeof assigneeResponseSchema>;
