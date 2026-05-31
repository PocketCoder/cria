import { format } from 'date-fns';
import { CalendarDays, Hash, AtSign, AlertTriangle, FolderKanban } from 'lucide-react';
import type { QuickAddResult } from '@/lib/quickAddParser';

interface Props {
  parsed: QuickAddResult;
}

/**
 * Slim chip row rendered beneath the "Add a task…" input, showing
 * what the natural-language parser pulled out. Hides itself entirely
 * when the input is plain title-only — keeps the resting state
 * un-cluttered.
 *
 * Doesn't try to inline-highlight the input value itself; that needs
 * either contentEditable or an absolute overlay sync'd to caret/scroll,
 * both of which fight the browser's native textbox UX more than they
 * help.
 */
export function QuickAddPreview({ parsed }: Props) {
  const { dueDate, priority, labelTitles, assigneeUsernames, projectTitle } = parsed;
  const hasAny =
    dueDate ||
    priority !== null ||
    labelTitles.length > 0 ||
    assigneeUsernames.length > 0 ||
    projectTitle != null;
  if (!hasAny) return null;

  return (
    <ul className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      {dueDate ? (
        <Chip
          icon={<CalendarDays className="h-3 w-3" />}
          tone="blue"
          label={formatDate(dueDate)}
        />
      ) : null}
      {priority !== null ? (
        <Chip
          icon={<AlertTriangle className="h-3 w-3" />}
          tone="amber"
          label={`!${priority}`}
        />
      ) : null}
      {labelTitles.map((t) => (
        <Chip
          key={`l-${t}`}
          icon={<Hash className="h-3 w-3" />}
          tone="neutral"
          label={t}
        />
      ))}
      {assigneeUsernames.map((u) => (
        <Chip
          key={`a-${u}`}
          icon={<AtSign className="h-3 w-3" />}
          tone="violet"
          label={u}
        />
      ))}
      {projectTitle ? (
        <Chip
          icon={<FolderKanban className="h-3 w-3" />}
          tone="teal"
          label={projectTitle}
        />
      ) : null}
    </ul>
  );
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'blue' | 'amber' | 'neutral' | 'violet' | 'teal';
}) {
  const toneClass = {
    blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    neutral: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
    violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  }[tone];
  return (
    <li
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${toneClass}`}
    >
      {icon}
      <span>{label}</span>
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return format(d, sameYear ? 'EEE d MMM' : 'd MMM yyyy');
  } catch {
    return iso;
  }
}
