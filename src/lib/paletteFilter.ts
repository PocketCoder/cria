import type { PaletteAction } from '@/components/paletteActions';

/** Case-insensitive match on label, keywords or subtitle. Empty query keeps all. */
export function filterPaletteActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const q = query.toLowerCase().trim();
  if (!q) return actions;
  return actions.filter(
    (a) =>
      a.label.toLowerCase().includes(q) ||
      a.keywords.toLowerCase().includes(q) ||
      a.subtitle.toLowerCase().includes(q),
  );
}

export interface PaletteGroup {
  name: string;
  items: PaletteAction[];
}

const GROUP_ORDER = ['Views', 'Projects', 'Labels', 'Tasks', 'Actions'];

/** Bucket actions by group in the fixed display order, dropping empty groups. */
export function groupPaletteActions(filtered: PaletteAction[]): PaletteGroup[] {
  const groupMap = new Map<string, PaletteAction[]>();
  for (const item of filtered) {
    const arr = groupMap.get(item.group) ?? [];
    arr.push(item);
    groupMap.set(item.group, arr);
  }
  const result: PaletteGroup[] = [];
  for (const name of GROUP_ORDER) {
    const items = groupMap.get(name);
    if (items?.length) result.push({ name, items });
  }
  return result;
}

/** Right-aligned label: task rows show `project · due`, others their subtitle. */
export function paletteRightLabel(
  item: Pick<PaletteAction, 'taskLocalId' | 'subtitle' | 'dueDate'>,
  formatDue: (iso: string) => string,
): string {
  return item.taskLocalId
    ? [item.subtitle, item.dueDate ? formatDue(item.dueDate) : null].filter(Boolean).join(' · ')
    : item.subtitle;
}
