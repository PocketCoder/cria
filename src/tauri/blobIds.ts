/**
 * Blob-store ids that are caches, not queued uploads. The orphan sweep
 * (src/sync/blobSweep.ts) must leave them alone: nothing in the DB refers to
 * them, so it would otherwise delete them after a day.
 */
export const PROJECT_BG_BLOB_PREFIX = 'project-bg-';

export const projectBackgroundBlobId = (serverId: number): string =>
  `${PROJECT_BG_BLOB_PREFIX}${serverId}`;

export const isCacheBlobId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith(PROJECT_BG_BLOB_PREFIX);
