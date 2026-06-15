import { format } from 'date-fns';
import { toCalendarDate } from '@/lib/dateFormat';
import { CalendarDays, Hash, AlertTriangle, Search } from 'lucide-react';
import type { SearchQuery } from '@/lib/searchQueryParser';

export function SearchQueryPreview({ parsed }: { parsed: SearchQuery }) {
  const { dueDateStart, labelTitle, priority, text } = parsed;
  const hasFilters = dueDateStart || labelTitle != null || priority != null;
  if (!hasFilters && !text) return null;

  return (
    <ul className="flex flex-wrap items-center gap-1 text-[11px]">
      {dueDateStart ? (
        <Chip
          icon={<CalendarDays className="h-3 w-3" />}
          tone="blue"
          label={`Due ${formatDate(dueDateStart)}`}
        />
      ) : null}
      {priority != null ? (
        <Chip
          icon={<AlertTriangle className="h-3 w-3" />}
          tone="amber"
          label={`!${priority}`}
        />
      ) : null}
      {labelTitle ? (
        <Chip
          icon={<Hash className="h-3 w-3" />}
          tone="neutral"
          label={labelTitle}
        />
      ) : null}
      {text ? (
        <Chip
          icon={<Search className="h-3 w-3" />}
          tone="neutral"
          label={`"${text}"`}
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
  tone: 'blue' | 'amber' | 'neutral';
}) {
  const toneClass = {
    blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    neutral: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
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
    return format(toCalendarDate(iso), 'd MMM');
  } catch {
    return iso;
  }
}
