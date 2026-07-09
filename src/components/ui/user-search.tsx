import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { searchUsers, type UserSearchResult } from '@/api/users';

/**
 * Debounced user search input with a result dropdown. Default source is the
 * server-wide /users search; pass `search` to scope it (e.g. project
 * members for mention/assignee pickers).
 */
export function UserSearchCombobox({
  onSelect,
  search = searchUsers,
  placeholder = 'Search users…',
  autoFocus,
}: {
  onSelect: (user: UserSearchResult) => void;
  search?: (query: string) => Promise<UserSearchResult[]>;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    const mySeq = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      search(query.trim())
        .then((users) => {
          if (seq.current !== mySeq) return;
          setResults(users);
          setOpen(true);
        })
        .catch((err) => {
          console.error('[user-search] failed:', err);
          if (seq.current === mySeq) setResults([]);
        })
        .finally(() => {
          if (seq.current === mySeq) setBusy(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [query, search]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
        {busy && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-md">
          {results.map((u) => (
            <li key={u.serverId}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-[var(--color-muted)]"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(u);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span>{u.name || u.username}</span>
                {u.name && (
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    @{u.username}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
