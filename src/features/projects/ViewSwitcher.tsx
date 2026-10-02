import type { ProjectView } from '@/domain/view';
import { SegmentedControl } from '@/components/ui/segmented-control';

interface ViewSwitcherProps {
  views: ProjectView[];
  activeViewLocalId: string | undefined;
  onSelect: (viewLocalId: string) => void;
}

const VIEW_LABELS: Record<string, string> = {
  list: 'List',
  kanban: 'Board',
  table: 'Table',
  gantt: 'Gantt',
};

export function ViewSwitcher({
  views,
  activeViewLocalId,
  onSelect,
}: ViewSwitcherProps) {
  if (views.length <= 1) return null;

  return (
    <SegmentedControl
      aria-label="View"
      options={views.map((v) => ({
        value: v.localId,
        label: v.title || VIEW_LABELS[v.viewKind] || v.viewKind,
      }))}
      value={activeViewLocalId}
      onChange={onSelect}
    />
  );
}
