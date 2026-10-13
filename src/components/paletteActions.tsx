import type { ReactNode } from 'react';
import { Calendar, Inbox, Star, FileText, Tag, Plus, Settings, Mic } from 'lucide-react';
import { useUi } from '@/stores/ui';
import type { Project } from '@/domain/project';
import type { Label } from '@/domain/label';
import type { TaskWithProject } from '@/db/tasks';

export interface PaletteAction {
  id: string;
  label: string;
  subtitle: string;
  group: string;
  keywords: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Task rows carry a priority bar + right-aligned `project · due` so the
   * palette doubles as triage. */
  taskLocalId?: string;
  priority?: number;
  dueDate?: string | null;
}

type UiState = ReturnType<typeof useUi.getState>;

export interface PaletteActionDeps {
  projects: Pick<Project, 'localId' | 'title'>[];
  labels: Pick<Label, 'localId' | 'title'>[];
  tasks: Pick<
    TaskWithProject,
    'localId' | 'title' | 'projectTitle' | 'projectLocalId' | 'priority' | 'dueDate'
  >[];
  setActiveView: UiState['setActiveView'];
  setSelectedProject: UiState['setSelectedProject'];
  onClose: () => void;
  onOpenQuickAdd: () => void;
  onOpenSettings: () => void;
  aiAvailable: boolean;
}

export function buildPaletteActions({
  projects,
  labels,
  tasks,
  setActiveView,
  setSelectedProject,
  onClose,
  onOpenQuickAdd,
  onOpenSettings,
  aiAvailable,
}: PaletteActionDeps): PaletteAction[] {
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
  if (aiAvailable) {
    list.push({
      id: 'action-ramble',
      label: 'Ramble',
      subtitle: 'Talk freely, get a list of tasks',
      group: 'Actions',
      keywords: 'ramble voice dictate speak brain dump ai many tasks',
      icon: <Mic className="h-4 w-4" />,
      onSelect: () => {
        onClose();
        useUi.getState().setRambleOpen(true);
      },
    });
  }
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
}
