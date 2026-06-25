export type SortField =
  | 'user_defined_order'
  | 'percentDone'
  | 'created'
  | 'dueDate'
  | 'endDate'
  | 'priority'
  | 'startDate'
  | 'title'
  | 'updated';

export type SortDirection = 'asc' | 'desc';

export interface SortRule {
  field: SortField;
  direction: SortDirection;
}

export interface SortOption {
  label: string;
  field: SortField;
  direction: SortDirection;
}

export const SORT_OPTIONS: SortOption[] = [
  { label: 'Manually', field: 'user_defined_order', direction: 'asc' },
  { label: '% done (Least done first)', field: 'percentDone', direction: 'asc' },
  { label: '% done (Most done first)', field: 'percentDone', direction: 'desc' },
  { label: 'Created (Newest first)', field: 'created', direction: 'desc' },
  { label: 'Created (Oldest first)', field: 'created', direction: 'asc' },
  { label: 'Due date (Earliest first)', field: 'dueDate', direction: 'asc' },
  { label: 'Due date (Latest first)', field: 'dueDate', direction: 'desc' },
  { label: 'End date (Earliest first)', field: 'endDate', direction: 'asc' },
  { label: 'End date (Latest first)', field: 'endDate', direction: 'desc' },
  { label: 'Priority (Highest first)', field: 'priority', direction: 'desc' },
  { label: 'Priority (Lowest first)', field: 'priority', direction: 'asc' },
  { label: 'Start date (Earliest first)', field: 'startDate', direction: 'asc' },
  { label: 'Start date (Latest first)', field: 'startDate', direction: 'desc' },
  { label: 'Title (A–Z)', field: 'title', direction: 'asc' },
  { label: 'Title (Z–A)', field: 'title', direction: 'desc' },
  { label: 'Updated (Newest first)', field: 'updated', direction: 'desc' },
  { label: 'Updated (Oldest first)', field: 'updated', direction: 'asc' },
];

const SORT_FIELD_TO_COLUMN: Record<string, string> = {
  user_defined_order: 'position',
  percentDone: 'percent_done',
  created: 'created_at',
  dueDate: 'due_date',
  endDate: 'end_date',
  priority: 'priority',
  startDate: 'start_date',
  title: 'title',
  updated: 'updated_at',
};

export function sortRuleToOrderBy(rule: SortRule | null): string {
  if (!rule) return '';

  const col = SORT_FIELD_TO_COLUMN[rule.field];
  if (!col) return '';

  const dir = rule.direction === 'desc' ? 'DESC' : 'ASC';

  if (rule.field === 'user_defined_order') {
    return `COALESCE(${col}, 999999) ${dir}`;
  }

  if (['percentDone', 'priority'].includes(rule.field)) {
    return `${col} ${dir}`;
  }

  if (['dueDate', 'endDate', 'startDate', 'created', 'updated'].includes(rule.field)) {
    return `${col} IS NULL, ${col} ${dir}`;
  }

  if (rule.field === 'title') {
    const dirClause = dir === 'DESC' ? 'DESC' : 'ASC COLLATE NOCASE';
    return `${col} ${dirClause}`;
  }

  return `${col} ${dir}`;
}
