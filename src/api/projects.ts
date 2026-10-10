import { callApi, createApiClient, createApiFetch, type ApiClient } from './client';
import { buildApiError, NetworkError } from './errors';

/**
 * Online-only project operations (no outbox): duplicate and backgrounds.
 */

/**
 * Duplicate a project. Server copies tasks, views, labels, comments,
 * attachments, relations, backgrounds and sharing (models.ProjectDuplicate).
 * `parentServerId` is the new copy's parent; 0 puts it at the top level.
 * Returns the copy's server id.
 */
export async function duplicateProject(
  projectServerId: number,
  parentServerId = 0,
  client: ApiClient = createApiClient(),
): Promise<number> {
  const data = await callApi(
    client.PUT('/projects/{projectID}/duplicate', {
      params: { path: { projectID: projectServerId } },
      body: { parent_project_id: parentServerId },
    }),
  );
  const id = data?.duplicated_project?.id;
  if (typeof id !== 'number') throw new Error('duplicateProject: no project in response');
  return id;
}

export interface UnsplashImage {
  id: string;
  url: string;
  thumb: string;
  author: string | null;
  authorName: string | null;
}

export async function searchUnsplash(
  query: string,
  page = 1,
  client: ApiClient = createApiClient(),
): Promise<UnsplashImage[]> {
  const data = await callApi(
    client.GET('/backgrounds/unsplash/search', {
      params: { query: { s: query, p: page } },
    }),
  );
  return (data ?? [])
    .filter((i) => typeof i.id === 'string')
    .map((i) => {
      const info = (i.info ?? {}) as { author?: string; author_name?: string };
      return {
        id: i.id as string,
        url: i.url ?? '',
        thumb: i.thumb ?? '',
        author: info.author ?? null,
        authorName: info.author_name ?? null,
      };
    });
}

/** Thumbnail bytes via the server's authenticated proxy (the CSP blocks remote images). */
export async function fetchUnsplashThumb(imageId: string): Promise<Blob> {
  const api = createApiFetch();
  const res = await api(`/backgrounds/unsplash/image/${encodeURIComponent(imageId)}/thumb`);
  if (!res.ok) throw buildApiError(res.status, await res.text().catch(() => ''));
  return res.blob();
}

export async function setUnsplashBackground(
  projectServerId: number,
  image: UnsplashImage,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/projects/{id}/backgrounds/unsplash', {
      params: { path: { id: projectServerId } },
      body: { id: image.id, url: image.url, thumb: image.thumb },
    }),
  );
}

export async function removeProjectBackground(
  projectServerId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/projects/{id}/background', {
      params: { path: { id: projectServerId } },
    }),
  );
}

export async function uploadProjectBackground(
  projectServerId: number,
  file: File | Blob,
): Promise<void> {
  const api = createApiFetch();
  const form = new FormData();
  form.append('background', file);
  let res: Response;
  try {
    res = await api(`/projects/${projectServerId}/backgrounds/upload`, {
      method: 'PUT',
      body: form,
    });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : String(err), err);
  }
  if (!res.ok) throw buildApiError(res.status, await res.text().catch(() => ''));
}

/**
 * The project's background image, or null when it has none (the endpoint
 * answers with a JSON error rather than image bytes in that case).
 */
export async function fetchProjectBackground(
  projectServerId: number,
): Promise<Blob | null> {
  const api = createApiFetch();
  const res = await api(`/projects/${projectServerId}/background`);
  if (res.status === 404) return null;
  if (!res.ok) throw buildApiError(res.status, await res.text().catch(() => ''));
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) return null;
  return res.blob();
}

/** Whether the instance offers a given background provider (`/info`). */
export function hasBackgroundProvider(
  providers: string[] | undefined,
  name: 'upload' | 'unsplash',
): boolean {
  return (providers ?? []).includes(name);
}

export interface ProjectInfo {
  ownerName: string | null;
  created: string | null;
}

/** Server-side metadata the local cache doesn't keep (online-only). */
export async function getProjectInfo(
  projectServerId: number,
  client: ApiClient = createApiClient(),
): Promise<ProjectInfo> {
  const data = await callApi(
    client.GET('/projects/{id}', { params: { path: { id: projectServerId } } }),
  );
  const owner = data?.owner;
  const created = data?.created;
  return {
    ownerName: owner?.name || owner?.username || null,
    // Vikunja's "no date" sentinel means unset.
    created: created && !created.startsWith('0001-') ? created : null,
  };
}
