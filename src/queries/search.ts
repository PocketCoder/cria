import { useQuery } from '@tanstack/react-query';
import { searchTasks, type TaskWithProject } from '@/db/tasks';
import { parseSearchQuery, type SearchQuery } from '@/lib/searchQueryParser';

/**
 * Search tasks with FTS5 + NL filters (due date, #label, !priority).
 * Query is debounced externally (Shell manages a debounced search query
 * so the UI feels responsive without hammering the DB on every keystroke).
 */
export function useSearchTasks(raw: string) {
  const parsed = raw.length >= 2 ? parseSearchQuery(raw) : { text: raw, dueDateStart: null, dueDateEnd: null, labelTitle: null, priority: null, tokens: [] };

  return {
    parsed: parsed as SearchQuery,
    query: useQuery<TaskWithProject[]>({
      queryKey: ['search', parsed],
      enabled: raw.length >= 2,
      staleTime: 30_000,
      queryFn: () =>
        searchTasks({
          text: parsed.text,
          dueDateStart: parsed.dueDateStart,
          dueDateEnd: parsed.dueDateEnd,
          labelTitle: parsed.labelTitle,
          priority: parsed.priority,
        }),
    }),
  };
}
