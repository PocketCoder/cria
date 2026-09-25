import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { searchTasks, updateTask } from '@/db/tasks';
import { cn } from '@/lib/cn';
import { formatDue } from '@/features/tasks/TaskRowCore';
import { priorityColor } from '@/components/ui/priority-select';
import { Calendar, Inbox, Star, FileText, Tag, Plus, Settings, Search } from 'lucide-react';

interface PaletteAction {
  id: string;
  label: string;
  subtitle: string;
  group: string;
  keywords: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Task rows carry a priority bar + right-aligned `project · due` so the
   * palette doubles as triage. */
  taskLocalId?: string;
  priority?: number;
  dueDate?: string | null;
}

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

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];

    list.push({
      id: 'view-today',
      label: 'Today',
      subtitle: 'View',
      group: 'Views',
      keywords: 'today smart view overdue',
      icon: <Calendar className="h-4 w-4" />,
      onSelect: () => {
        setActiveView({ kind: 'today' });
        onClose();
      },
    });
    list.push({
      id: 'view-upcoming',
      label: 'Upcoming',
      subtitle: 'View',
      group: 'Views',
      keywords: 'upcoming smart view future',
      icon: <Calendar className="h-4 w-4" />,
      onSelect: () => {
        setActiveView({ kind: 'upcoming' });
        onClose();
      },
    });
    list.push({
      id: 'view-inbox',
      label: 'Inbox',
      subtitle: 'View',
      group: 'Views',
      keywords: 'inbox smart view',
      icon: <Inbox className="h-4 w-4" />,
      onSelect: () => {
        setActiveView({ kind: 'inbox' });
        onClose();
      },
    });
    list.push({
      id: 'view-favorites',
      label: 'Favorites',
      subtitle: 'View',
      group: 'Views',
      keywords: 'favorites smart view starred',
      icon: <Star className="h-4 w-4" />,
      onSelect: () => {
        setActiveView({ kind: 'favorites' });
        onClose();
      },
    });

    for (const p of projects) {
      list.push({
        id: `project-${p.localId}`,
        label: p.title,
        subtitle: 'Project',
        group: 'Projects',
        keywords: `project ${p.title}`,
        icon: <FileText className="h-4 w-4" />,
        onSelect: () => {
          setSelectedProject(p.localId);
          onClose();
        },
      });
    }

    for (const l of labels) {
      list.push({
        id: `label-${l.localId}`,
        label: l.title,
        subtitle: 'Label',
        group: 'Labels',
        keywords: `label ${l.title}`,
        icon: <Tag className="h-4 w-4" />,
        onSelect: () => {
          setActiveView({ kind: 'label', localId: l.localId });
          onClose();
        },
      });
    }

    for (const t of tasks) {
      list.push({
        id: `task-${t.localId}`,
        label: t.title,
        subtitle: t.projectTitle,
        group: 'Tasks',
        keywords: `task ${t.title} ${t.projectTitle}`,
        icon: null,
        taskLocalId: t.localId,
        priority: t.priority,
        dueDate: t.dueDate,
        onSelect: () => {
          useUi.setState({
            activeView: { kind: 'project', localId: t.projectLocalId },
            selectedTaskLocalId: t.localId,
          });
          onClose();
        },
      });
    }

    list.push({
      id: 'action-quick-add',
      label: 'Quick Add',
      subtitle: 'Action',
      group: 'Actions',
      keywords: 'quick add create task',
      icon: <Plus className="h-4 w-4" />,
      onSelect: () => {
        onClose();
        onOpenQuickAdd();
      },
    });
    list.push({
      id: 'action-settings',
      label: 'Settings',
      subtitle: 'Action',
      group: 'Actions',
      keywords: 'settings preferences options configure',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => {
        onClose();
        onOpenSettings();
      },
    });

    return list;
  }, [projects, labels, tasks, setActiveView, setSelectedProject, onClose, onOpenQuickAdd, onOpenSettings]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.keywords.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q),
    );
  }, [query, actions]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

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
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // ⌘⏎ completes the selected task without leaving the palette.
      const t = filtered[selectedIndex];
      if (t?.taskLocalId) {
        e.preventDefault();
        void updateTask(t.taskLocalId, { done: true }).then(() => {
          queryClient.invalidateQueries({ queryKey: ['palette-tasks'] });
        });
      }
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].onSelect();
    }
  };

  const grouped = useMemo(() => {
    const groupOrder = ['Views', 'Projects', 'Labels', 'Tasks', 'Actions'];
    const groupMap = new Map<string, PaletteAction[]>();
    for (const item of filtered) {
      const arr = groupMap.get(item.group) ?? [];
      arr.push(item);
      groupMap.set(item.group, arr);
    }
    const result: { name: string; items: PaletteAction[] }[] = [];
    for (const name of groupOrder) {
      const items = groupMap.get(name);
      if (items?.length) result.push({ name, items });
    }
    return result;
  }, [filtered]);

  let flatIdx = 0;

  return (
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay-backdrop)] pt-[70px]"
      onClick={onClose}
    >
      <div
        className="w-[560px] overflow-hidden rounded-[14px] bg-[var(--color-card)] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] dark:border dark:border-[var(--sheet-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tasks, actions, projects, labels…"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
                const isSelected = idx === selectedIndex;
                const right = item.taskLocalId
                  ? [item.subtitle, item.dueDate ? formatDue(item.dueDate) : null]
                      .filter(Boolean)
                      .join(' · ')
                  : item.subtitle;
                return (
                  <button
                    key={item.id}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)]'
                        : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
                    )}
                    onClick={() => item.onSelect()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    {item.taskLocalId ? (
                      <span
                        className="h-4 w-[3px] shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            (item.priority ?? 0) > 2
                              ? priorityColor(item.priority ?? 0)
                              : 'transparent',
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
