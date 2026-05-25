import { z } from 'zod';

export interface Label {
  localId: string;
  serverId: number | null;
  title: string;
  description: string | null;
  hexColor: string | null;
  updatedAt: string;
}

export const labelResponseSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullable().optional(),
    hex_color: z.string().nullable().optional(),
    updated: z.string().nullable().optional(),
  })
  .passthrough();

export type LabelResponse = z.infer<typeof labelResponseSchema>;
