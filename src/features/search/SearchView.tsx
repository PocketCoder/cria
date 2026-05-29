import { Search, Loader2 } from 'lucide-react';
import { useSearchTasks } from '@/queries/search';
import { SmartTaskRow } from '@/features/smart-views/SmartViews';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { SearchQueryPreview } from './SearchQueryPreview';

export function SearchView({ query }: { query: string }) {
  const { parsed, query: { data: results = [], isLoading } } = useSearchTasks(query);
  const hasQuery = query.trim().length > 0;

  return (
    <>
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
        <h1 className="text-base font-semibold tracking-tight">Search</h1>
        {results.length > 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        ) : !isLoading && hasQuery ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            No results
          </span>
        ) : null}
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {hasQuery && (parsed.dueDateStart || parsed.priority != null || parsed.labelTitle || parsed.text) ? (
            <div className="border-b border-[var(--color-border)] px-6 py-2">
              <SearchQueryPreview parsed={parsed} />
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching…
            </div>
          ) : !hasQuery ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <Search className="h-8 w-8 text-[var(--color-muted-foreground)]" />
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Type to search tasks.
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Try &ldquo;due today #cheese !2&rdquo;
              </p>
            </div>
          ) : results.length === 0 ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              No results for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <ul>
              {results.map((t) => (
                <SmartTaskRow key={t.localId} task={t} showProject />
              ))}
            </ul>
          )}
        </section>
        <TaskDetail />
      </div>
    </>
  );
}
