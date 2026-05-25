import { z } from 'zod';

export interface Task {
  localId: string;
  serverId: number | null;
  projectLocalId: string;
  title: string;
  description: string | null;
  done: boolean;
  doneAt: string | null;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  priority: number;
  percentDone: number;
  hexColor: string | null;
  position: number | null;
  updatedAt: string;
}

export const taskResponseSchema = z
  .object({
    id: z.number(),
    project_id: z.number(),
    title: z.string(),
    description: z.string().nullable().optional(),
    done: z.boolean().nullable().optional(),
    done_at: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    priority: z.number().nullable().optional(),
    percent_done: z.number().nullable().optional(),
    hex_color: z.string().nullable().optional(),
    position: z.number().nullable().optional(),
    updated: z.string().nullable().optional(),
    created: z.string().nullable().optional(),
  })
  .passthrough();

export type TaskResponse = z.infer<typeof taskResponseSchema>;

const VIKUNJA_ZERO_DATE = '0001-01-01T00:00:00Z';

/** Vikunja serialises "no date" as 0001-01-01; treat that as null locally. */
export function normaliseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === VIKUNJA_ZERO_DATE) return null;
  return value;
}

export interface TaskInput {
  title: string;
  projectLocalId: string;
  description?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  priority?: number;
  percentDone?: number;
  hexColor?: string | null;
}

export type TaskUpdate = Partial<Omit<TaskInput, 'projectLocalId'>> & {
  done?: boolean;
};
