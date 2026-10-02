import type { Project } from '@/domain/project';

/**
 * Which project the quick-add chip row shows: a typed `+project` token wins
 * (no colour, since it may not match a real project), else the chosen project.
 */
export function resolveProjectChip(
  parsedProjectTitle: string | null,
  projects: Pick<Project, 'localId' | 'title' | 'hexColor'>[],
  projectId: string | null,
): { title: string | null | undefined; color: string | null } {
  const title =
    parsedProjectTitle ??
    (projectId ? projects.find((p) => p.localId === projectId)?.title : null);
  const color = parsedProjectTitle
    ? null
    : projects.find((p) => p.localId === projectId)?.hexColor ?? null;
  return { title, color };
}

/** Case-insensitive project lookup for a `+project` token. */
export function findProjectByTitle<T extends Pick<Project, 'title'>>(
  projects: T[],
  title: string,
): T | undefined {
  const lower = title.toLowerCase();
  return projects.find((p) => p.title.toLowerCase() === lower);
}

/**
 * Target project: an explicit choice wins elsewhere; this is the fallback —
 * the open project (only if it is a real, selectable project), else the user's
 * default project, else the first project.
 */
export function pickFallbackProjectId(
  projects: Pick<Project, 'localId' | 'serverId'>[],
  selectedProjectId: string | null,
  defaultServerProjectId: number | null | undefined,
): string | null {
  if (projects.length === 0) return null;
  if (selectedProjectId && projects.some((p) => p.localId === selectedProjectId)) {
    return selectedProjectId;
  }
  const def = defaultServerProjectId
    ? projects.find((p) => p.serverId === defaultServerProjectId)
    : undefined;
  return (def ?? projects[0]!).localId;
}
