import { format } from 'date-fns';
import { CalendarDays, Tag, UserPlus, Folder, AlertTriangle, Repeat } from 'lucide-react';
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
 * either contentEditable or an absolute overlay sync'd to caret/position,
 * both of which fight the browser's native textbox UX more than they
 * help.
 */
export function QuickAddPreview({ parsed }: Props) {
  const {
    dueDate,
    priority,
    labelTitles,
    assigneeUsernames,
    projectTitle,
    repeatAfter,
    repeatMode,
  } = parsed;
  const hasAny =
    dueDate ||
    priority !== null ||
    labelTitles.length > 0 ||
    assigneeUsernames.length > 0 ||
    projectTitle ||
    repeatAfter !== null ||
    repeatMode !== null;
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
          icon={<Tag className="h-3 w-3" />}
          tone="violet"
          label={t}
        />
      ))}
      {assigneeUsernames.map((u) => (
        <Chip
          key={`a-${u}`}
          icon={<UserPlus className="h-3 w-3" />}
          tone="indigo"
          label={u}
        />
      ))}
      {projectTitle ? (
        <Chip
          icon={<Folder className="h-3 w-3" />}
          tone="teal"
          label={projectTitle}
        />
      ) : null}
      {repeatAfter !== null || repeatMode !== null ? (
        <Chip
          icon={<Repeat className="h-3 w-3" />}
          tone="neutral"
          label={repeatLabel(repeatAfter, repeatMode)}
        />
      ) : null}
    </ul>
  );
}

function repeatLabel(repeatAfter: number | null, repeatMode: number | null): string {
  if (repeatMode === 1) return 'Monthly';
  if (repeatAfter === null) return '';
  const HOUR = 3600;
  const DAY = 86400;
  const WEEK = 604800;
  const YEAR = 31536000;
  if (repeatAfter % YEAR === 0 && repeatAfter >= YEAR) {
    const n = repeatAfter / YEAR;
    return n === 1 ? 'Yearly' : `Every ${n} years`;
  }
  if (repeatAfter % WEEK === 0 && repeatAfter >= WEEK) {
    const n = repeatAfter / WEEK;
    return n === 1 ? 'Weekly' : `Every ${n} weeks`;
  }
  if (repeatAfter % DAY === 0 && repeatAfter >= DAY) {
    const n = repeatAfter / DAY;
    return n === 1 ? 'Daily' : `Every ${n} days`;
  }
  if (repeatAfter % HOUR === 0 && repeatAfter >= HOUR) {
    const n = repeatAfter / HOUR;
    return n === 1 ? 'Hourly' : `Every ${n} hours`;
  }
  return `Every ${repeatAfter}s`;
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'blue' | 'amber' | 'violet' | 'indigo' | 'teal' | 'neutral';
}) {
  const toneClass = {
    blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    indigo: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
    neutral: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
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
