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
  isFavorite: boolean;
  isSubscribed: boolean;
  repeatAfter: number;
  repeatMode: number;
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
    is_favorite: z.boolean().nullable().optional(),
    repeat_after: z.number().nullable().optional(),
    repeat_mode: z.number().nullable().optional(),
    // Vikunja's GET /tasks embeds the task's labels inline. We don't
    // validate the inner shape here — labelResponseSchema will do that
    // when the sync layer routes each label through upsertLabelFromServer.
    labels: z.array(z.unknown()).nullable().optional(),
    // assignees are embedded in the task response; parsed separately
    assignees: z.array(z.unknown()).nullable().optional(),
    // attachments are embedded read-only; parsed by taskAttachmentSchema
    // and mirrored into task_attachments on pull.
    attachments: z.array(z.unknown()).nullable().optional(),
    // reminders are embedded; parsed by taskReminderSchema and mirrored
    // into task_reminders on pull (drives local notifications).
    reminders: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

export type TaskResponse = z.infer<typeof taskResponseSchema>;

/**
 * One inline task reminder (models.TaskReminder). `reminder` is the
 * absolute trigger time (Vikunja resolves it even for relative
 * reminders); relative_period/relative_to describe a relative offset.
 */
export const taskReminderSchema = z
  .object({
    reminder: z.string().nullable().optional(),
    relative_period: z.number().nullable().optional(),
    relative_to: z.string().nullable().optional(),
  })
  .passthrough();

export type TaskReminderResponse = z.infer<typeof taskReminderSchema>;

/**
 * One inline task attachment (models.TaskAttachment). `id` is the
 * attachment id used to build the download URL; `file` carries the
 * displayable metadata (name / size / mime).
 */
export const taskAttachmentSchema = z
  .object({
    id: z.number(),
    task_id: z.number().nullable().optional(),
    created: z.string().nullable().optional(),
    file: z
      .object({
        id: z.number().nullable().optional(),
        name: z.string().nullable().optional(),
        size: z.number().nullable().optional(),
        mime: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export type TaskAttachmentResponse = z.infer<typeof taskAttachmentSchema>;

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
  isFavorite?: boolean;
  repeatAfter?: number;
  repeatMode?: number;
}

export interface TaskAssigneeData {
  userServerId: number;
  username?: string;
  name?: string;
  email?: string;
}

export type TaskUpdate = Partial<Omit<TaskInput, 'projectLocalId'>> & {
  done?: boolean;
  isSubscribed?: boolean;
};
