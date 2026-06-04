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
  createdAt: string | null;
  /** Server user id of the creator. We don't model users locally, so the
   * table view resolves this to "You" (current user) or `#id`. */
  createdById: number | null;
  identifier: string | null;
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
    created_by: z
      .object({ id: z.number().nullable().optional() })
      .nullable()
      .optional(),
    is_favorite: z.boolean().nullable().optional(),
    repeat_after: z.number().nullable().optional(),
    repeat_mode: z.number().nullable().optional(),
    identifier: z.string().nullable().optional(),
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
    // related_tasks is a map keyed by RelationKind ("subtask",
    // "parenttask", "related", "blocking", "blocked", "duplicates",
    // "duplicateof", "precedes", "follows", "copiedfrom", "copiedto")
    // whose values are arrays of Task. Mirrored into task_relations on
    // pull. We don't validate the inner Task shape here — the relation
    // sync only needs each task's id + title + done state, and pulling
    // the full task list afterwards keeps the rest in sync.
    related_tasks: z.record(z.array(z.unknown())).nullable().optional(),
  })
  .passthrough();

export type TaskResponse = z.infer<typeof taskResponseSchema>;

/**
 * Vikunja's RelationKind enum, verbatim. Vikunja's frontend exposes 9
 * of these in its add-relation picker (the inverses parenttask /
 * blocked / follows / duplicateof / copiedto auto-populate from the
 * other side) but the server returns all 12 in the related_tasks map.
 * We mirror the same: store everything, pick from the picker subset.
 */
export const TASK_RELATION_KINDS = [
  'subtask',
  'parenttask',
  'related',
  'duplicates',
  'duplicateof',
  'blocking',
  'blocked',
  'precedes',
  'follows',
  'copiedfrom',
  'copiedto',
] as const;
export type TaskRelationKind = (typeof TASK_RELATION_KINDS)[number];

/** Kinds the user can pick from the add-relation UI. The other six come
 * back automatically on the other task once the server inverts. */
export const TASK_RELATION_PICKABLE_KINDS = [
  'subtask',
  'parenttask',
  'related',
  'blocking',
  'blocked',
  'duplicates',
  'precedes',
  'follows',
  'copiedfrom',
] as const satisfies readonly TaskRelationKind[];

/** Inverse used when the server auto-creates the other side. Kept
 * client-side so we can show optimistic inverse rows before the next
 * pull confirms them. */
export function inverseRelationKind(k: TaskRelationKind): TaskRelationKind {
  switch (k) {
    case 'subtask': return 'parenttask';
    case 'parenttask': return 'subtask';
    case 'related': return 'related';
    case 'duplicates': return 'duplicateof';
    case 'duplicateof': return 'duplicates';
    case 'blocking': return 'blocked';
    case 'blocked': return 'blocking';
    case 'precedes': return 'follows';
    case 'follows': return 'precedes';
    case 'copiedfrom': return 'copiedto';
    case 'copiedto': return 'copiedfrom';
  }
}

/**
 * Minimal shape needed from the embedded related task to render a row
 * (title + done + ids). The full task lands separately through the
 * regular task pull, so we don't need every field here.
 */
export const relatedTaskSchema = z
  .object({
    id: z.number(),
    title: z.string().nullable().optional(),
    done: z.boolean().nullable().optional(),
    project_id: z.number().nullable().optional(),
  })
  .passthrough();

export type RelatedTaskResponse = z.infer<typeof relatedTaskSchema>;

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
