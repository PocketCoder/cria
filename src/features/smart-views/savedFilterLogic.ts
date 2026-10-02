import { parseFilterQuery } from '@/lib/filterQueryParser';
import type { SavedFilter } from '@/db/savedFilters';

export interface FilterForm {
  title: string;
  description: string;
  query: string;
  includeNulls: boolean;
}

/** Form values for a new filter, or seeded from `existing` when editing. */
export function initialFilterForm(existing?: SavedFilter | null): FilterForm {
  return {
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    query: existing?.filterQuery ?? '',
    includeNulls: existing?.filterIncludeNulls ?? false,
  };
}

/** Message from the filter parser, or null when the query is blank or valid. */
export function filterParseError(query: string, now: Date): string | null {
  if (!query.trim()) return null;
  try {
    parseFilterQuery(query, now);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function canSaveFilter(args: {
  online: boolean;
  busy: boolean;
  title: string;
  query: string;
  parseError: string | null;
}): boolean {
  return (
    args.online &&
    !args.busy &&
    args.title.trim().length > 0 &&
    args.query.trim().length > 0 &&
    !args.parseError
  );
}

/** Body for the create/update API call. */
export function buildFilterInput(form: FilterForm) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    filter: form.query.trim(),
    filterIncludeNulls: form.includeNulls,
  };
}
