import { useQuery } from '@tanstack/react-query';
import { AdaptiveDialog } from '@/components/ui/adaptive-dialog';
import { RichTextView } from '@/features/task-detail/RichTextReadView';
import { isEmptyDescription } from '@/features/task-detail/editorLogic';
import { getProjectInfo } from '@/api/projects';
import { getProjectTaskStats } from '@/db/projects';
import { useProjects } from '@/queries/projects';
import { useOnline } from '@/hooks/useOnline';
import { useDateFormatter } from '@/lib/dateFormat';
import type { Project } from '@/domain/project';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-24 shrink-0 text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Read-only project description and metadata. */
export function ProjectInfoModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const online = useOnline();
  const { formatDate } = useDateFormatter();
  const { data: projects = [] } = useProjects();
  const parent = projects.find((p) => p.localId === project.parentLocalId);
  const { data: stats } = useQuery({
    queryKey: ['project-stats', project.localId],
    queryFn: () => getProjectTaskStats(project.localId),
  });
  const serverId = project.serverId;
  const { data: info } = useQuery({
    queryKey: ['project-info', serverId],
    queryFn: () => getProjectInfo(serverId!),
    enabled: online && serverId != null && serverId > 0,
    retry: false,
  });

  return (
    <AdaptiveDialog
      label={`About “${project.title}”`}
      onClose={onClose}
      title={
        <>
          {project.hexColor && (
            <span
              aria-hidden="true"
              className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: project.hexColor }}
            />
          )}
          {project.title}
        </>
      }
    >
      <div className="p-4 text-xs">
        {!isEmptyDescription(project.description) && (
          <RichTextView
            html={project.description ?? ''}
            taskServerId={null}
            className="prose-sm mb-3 text-sm"
          />
        )}
        <dl className="divide-y divide-[var(--color-border)]">
          {project.identifier && <Row label="Identifier">{project.identifier}</Row>}
          {parent && <Row label="Parent">{parent.title}</Row>}
          <Row label="Tasks">{stats ? `${stats.open} open, ${stats.done} done` : '…'}</Row>
          {info?.ownerName && <Row label="Owner">{info.ownerName}</Row>}
          {info?.created && <Row label="Created">{formatDate(info.created)}</Row>}
          {project.updatedAt && <Row label="Updated">{formatDate(project.updatedAt)}</Row>}
          {project.isArchived && <Row label="Status">Archived</Row>}
          {project.isFavorite && <Row label="Favourite">Yes</Row>}
        </dl>
        {!online && (
          <p className="pt-2 text-[var(--color-muted-foreground)]">
            Offline: owner and creation date need a connection.
          </p>
        )}
      </div>
    </AdaptiveDialog>
  );
}
