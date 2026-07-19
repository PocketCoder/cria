/**
 * Human-readable text for Vikunja in-app notifications. Payload shapes
 * mirror upstream pkg/models/notifications.go ToDB() structs; the schema
 * types them as unknown, so everything here is defensive — unknown names
 * fall back to the raw name and nothing throws.
 */

export interface ParsedNotification {
  text: string;
  /** Server id of the task to open on click, when one applies. */
  taskServerId: number | null;
}

interface UserRef {
  username?: string;
  name?: string;
}

interface TaskRef {
  id?: number;
  title?: string;
}

function userName(u: unknown): string {
  const user = (u ?? {}) as UserRef;
  return user.name || user.username || 'Someone';
}

function taskTitle(t: unknown): string {
  return ((t ?? {}) as TaskRef).title || 'a task';
}

function taskId(t: unknown): number | null {
  const id = ((t ?? {}) as TaskRef).id;
  return typeof id === 'number' ? id : null;
}

export function parseNotification(
  name: string,
  payload: unknown,
): ParsedNotification {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  switch (name) {
    case 'task.assigned':
      return {
        text: `${userName(p.doer)} assigned you to “${taskTitle(p.task)}”`,
        taskServerId: taskId(p.task),
      };
    case 'task.comment':
      return {
        text: p.mentioned === true
          ? `${userName(p.doer)} mentioned you in a comment on “${taskTitle(p.task)}”`
          : `${userName(p.doer)} commented on “${taskTitle(p.task)}”`,
        taskServerId: taskId(p.task),
      };
    case 'task.mentioned':
      return {
        text: `${userName(p.doer)} mentioned you on “${taskTitle(p.task)}”`,
        taskServerId: taskId(p.task),
      };
    case 'task.deleted':
      return {
        text: `${userName(p.doer)} deleted “${taskTitle(p.task)}”`,
        taskServerId: null,
      };
    case 'task.reminder':
      return {
        text: `Reminder: “${taskTitle(p.task)}”`,
        taskServerId: taskId(p.task),
      };
    case 'task.undone.overdue':
      return {
        text: taskId(p.task) != null
          ? `“${taskTitle(p.task)}” is overdue`
          : 'You have overdue tasks',
        taskServerId: taskId(p.task),
      };
    case 'team.member.added':
      return {
        text: `${userName(p.doer)} added ${userName(p.member)} to team “${((p.team ?? {}) as { name?: string }).name ?? 'a team'}”`,
        taskServerId: null,
      };
    case 'project.created':
      return {
        text: `${userName(p.doer)} created project “${((p.project ?? {}) as { title?: string }).title ?? ''}”`,
        taskServerId: null,
      };
    case 'data.export.ready':
      return { text: 'Your data export is ready to download', taskServerId: null };
    default:
      return { text: name, taskServerId: null };
  }
}
