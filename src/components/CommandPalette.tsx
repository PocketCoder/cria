import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { searchTasks, updateTask } from '@/db/tasks';
import { cn } from '@/lib/cn';
import { formatDue } from '@/features/tasks/taskRowHelpers';
import { priorityColor } from '@/components/ui/priority';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { Search } from 'lucide-react';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { buildPaletteActions, type PaletteAction } from '@/components/paletteActions';
import { filterPaletteActions, groupPaletteActions, paletteRightLabel } from '@/lib/paletteFilter';

export function CommandPalette({
  onClose,
  onOpenQuickAdd,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenQuickAdd: () => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setActiveView = useUi((s) => s.setActiveView);
  const setSelectedProject = useUi((s) => s.setSelectedProject);
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();
  const { data: labels = [] } = useLabels();
  const aiAvailable = useAiAvailable();

  const { data: tasks = [] } = useQuery({
    queryKey: ['palette-tasks', debouncedQuery],
    queryFn: () => searchTasks({ text: debouncedQuery }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const actions = useMemo<PaletteAction[]>(
    () =>
      buildPaletteActions({
        projects,
        labels,
        tasks,
        setActiveView,
        setSelectedProject,
        onClose,
        onOpenQuickAdd,
        onOpenSettings,
        aiAvailable,
      }),
    [projects, labels, tasks, setActiveView, setSelectedProject, onClose, onOpenQuickAdd, onOpenSettings, aiAvailable],
  );

  const filtered = useMemo(() => filterPaletteActions(actions, query), [query, actions]);

  // Selection resets in the query onChange; clamp covers the list shrinking.
  const activeIndex = Math.min(selectedIndex, Math.max(filtered.length - 1, 0));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(Math.min(activeIndex + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // ⌘⏎ completes the selected task without leaving the palette.
      const t = filtered[activeIndex];
      if (t?.taskLocalId) {
        e.preventDefault();
        void updateTask(t.taskLocalId, { done: true }).then(() => {
          queryClient.invalidateQueries({ queryKey: ['palette-tasks'] });
        });
      }
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      filtered[activeIndex].onSelect();
    }
  };

  const grouped = useMemo(() => groupPaletteActions(filtered), [filtered]);

  let flatIdx = 0;

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay-backdrop)] pt-[70px]">
      <BackdropDismiss onDismiss={onClose} />
      <div className="relative w-[560px] overflow-hidden rounded-[14px] bg-[var(--color-card)] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] dark:border dark:border-[var(--sheet-border)]">
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          <input
            aria-label="Command palette search"
            ref={inputRef}
            type="text"
            placeholder="Search tasks, actions, projects, labels…"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]">
            esc
          </span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {grouped.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-[var(--color-muted-foreground)]">
              No results for &ldquo;{query}&rdquo;
            </p>
          )}
          {grouped.map((group) => (
            <div key={group.name}>
              <p className="px-2 pb-1 pt-3 group-label text-[var(--color-muted-foreground)]">
                {group.name}
              </p>
              {group.items.map((item) => {
                const idx = flatIdx++;
                return (
                  <PaletteRow
                    key={item.id}
                    item={item}
                    isSelected={idx === activeIndex}
                    onHover={() => setSelectedIndex(idx)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2 text-[11.5px] text-[var(--color-muted-foreground)]">
          <span>&uarr;&darr; navigate &middot; ⏎ open &middot; ⌘⏎ mark done</span>          <span>
            {filtered.length} result{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}

function PaletteRow({
  item,
  isSelected,
  onHover,
}: {
  item: PaletteAction;
  isSelected: boolean;
  onHover: () => void;
}) {
  const right = paletteRightLabel(item, formatDue);
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
        isSelected
          ? 'bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)]'
          : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
      )}
      onClick={() => item.onSelect()}
      onMouseEnter={onHover}
    >
      {item.taskLocalId ? (
        <span
          className="h-4 w-[3px] shrink-0 rounded-full"
          style={{
            backgroundColor:
              (item.priority ?? 0) > 2 ? priorityColor(item.priority ?? 0) : 'transparent',
          }}
        />
      ) : (
        <span className="flex w-[3px] shrink-0 justify-center">
          <span className="opacity-60">{item.icon}</span>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
      {right ? (
        <span
          className={cn(
            'shrink-0 text-[11.5px]',
            isSelected
              ? 'text-[var(--color-inverse-foreground)]/70'
              : 'text-[var(--color-muted-foreground)]',
          )}
        >
          {right}
        </span>
      ) : null}
    </button>
  );
}
