import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  duplicateProject,
  fetchProjectBackground,
  getProjectInfo,
  hasBackgroundProvider,
  removeProjectBackground,
  searchUnsplash,
  setUnsplashBackground,
  uploadProjectBackground,
} from '@/api/projects';

const { mockCallApi, mockCreateApiClient, mockApiFetch } = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
  mockCreateApiClient: vi.fn(),
  mockApiFetch: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  callApi: mockCallApi,
  createApiClient: mockCreateApiClient,
  createApiFetch: () => mockApiFetch,
}));

const mockClient = { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateApiClient.mockReturnValue(mockClient);
});

describe('projects api', () => {
  it('duplicateProject PUTs the duplicate route and returns the copy id', async () => {
    mockCallApi.mockResolvedValue({ duplicated_project: { id: 42 } });
    const id = await duplicateProject(7, 3);
    expect(mockClient.PUT).toHaveBeenCalledWith('/projects/{projectID}/duplicate', {
      params: { path: { projectID: 7 } },
      body: { parent_project_id: 3 },
    });
    expect(id).toBe(42);
  });

  it('duplicateProject defaults to top level and throws without a copy', async () => {
    mockCallApi.mockResolvedValue({});
    await expect(duplicateProject(7)).rejects.toThrow(/no project/);
    expect(mockClient.PUT.mock.calls[0]?.[1].body).toEqual({ parent_project_id: 0 });
  });

  it('searchUnsplash maps images and drops ones without an id', async () => {
    mockCallApi.mockResolvedValue([
      { id: 'a', url: 'u', thumb: 't', info: { author: 'x', author_name: 'X Y' } },
      { url: 'no-id' },
    ]);
    const out = await searchUnsplash('sea');
    expect(mockClient.GET).toHaveBeenCalledWith('/backgrounds/unsplash/search', {
      params: { query: { s: 'sea', p: 1 } },
    });
    expect(out).toEqual([
      { id: 'a', url: 'u', thumb: 't', author: 'x', authorName: 'X Y' },
    ]);
  });

  it('setUnsplashBackground POSTs the image', async () => {
    await setUnsplashBackground(5, { id: 'a', url: 'u', thumb: 't', author: null, authorName: null });
    expect(mockClient.POST).toHaveBeenCalledWith('/projects/{id}/backgrounds/unsplash', {
      params: { path: { id: 5 } },
      body: { id: 'a', url: 'u', thumb: 't' },
    });
  });

  it('removeProjectBackground DELETEs', async () => {
    await removeProjectBackground(5);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/projects/{id}/background', {
      params: { path: { id: 5 } },
    });
  });

  it('uploadProjectBackground PUTs multipart field "background"', async () => {
    mockApiFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await uploadProjectBackground(5, new Blob(['x'], { type: 'image/png' }));
    const [path, init] = mockApiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/projects/5/backgrounds/upload');
    expect(init.method).toBe('PUT');
    expect((init.body as FormData).has('background')).toBe(true);
  });

  it('uploadProjectBackground throws on HTTP errors', async () => {
    mockApiFetch.mockResolvedValue(new Response('too big', { status: 403 }));
    await expect(uploadProjectBackground(5, new Blob(['x']))).rejects.toThrow();
  });

  it('fetchProjectBackground returns null for 404 and non-image bodies', async () => {
    mockApiFetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await fetchProjectBackground(5)).toBeNull();
    mockApiFetch.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(await fetchProjectBackground(5)).toBeNull();
  });

  it('fetchProjectBackground returns the blob for images', async () => {
    mockApiFetch.mockResolvedValue(
      new Response('img', { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    expect(await fetchProjectBackground(5)).toBeInstanceOf(Blob);
  });

  it('hasBackgroundProvider checks the /info list', () => {
    expect(hasBackgroundProvider(['upload'], 'upload')).toBe(true);
    expect(hasBackgroundProvider(['upload'], 'unsplash')).toBe(false);
    expect(hasBackgroundProvider(undefined, 'upload')).toBe(false);
  });

  it('getProjectInfo maps owner and treats the no-date sentinel as unset', async () => {
    mockCallApi.mockResolvedValue({
      owner: { username: 'jake', name: '' },
      created: '0001-01-01T00:00:00Z',
    });
    expect(await getProjectInfo(5)).toEqual({ ownerName: 'jake', created: null });
    mockCallApi.mockResolvedValue({
      owner: { username: 'jake', name: 'Jake W' },
      created: '2026-01-02T03:04:05Z',
    });
    expect(await getProjectInfo(5)).toEqual({
      ownerName: 'Jake W',
      created: '2026-01-02T03:04:05Z',
    });
  });
});
