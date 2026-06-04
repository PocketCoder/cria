import { format } from 'date-fns';

/**
 * Compact date cell for the table view. Shows `d MMM yyyy`, with the full
 * timestamp on hover. Renders an em-dash for no date.
 */
export function DateCell({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-[var(--color-muted-foreground)]">—</span>;
  }
  let date: Date;
  try {
    date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('invalid');
  } catch {
    return <span>{value}</span>;
  }
  return (
    <time dateTime={value} title={format(date, 'PPpp')} className="tabular-nums">
      {format(date, 'd MMM yyyy')}
    </time>
  );
}
