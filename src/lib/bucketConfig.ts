import { parseFilterQuery } from './filterQueryParser';

/**
 * Filter-mode kanban boards (Vikunja `bucket_configuration_mode: "filter"`):
 * each column is defined by a title and a filter query instead of stored
 * buckets. The server keeps them as `bucket_configuration`, an array of
 * `{ title, filter: TaskCollection }` that Cria stores as a JSON string on the
 * view.
 */
export interface BucketFilterConfig {
  title: string;
  filter: string;
  includeNulls: boolean;
}

interface RawEntry {
  title?: unknown;
  filter?: { filter?: unknown; filter_include_nulls?: unknown } | null;
  [key: string]: unknown;
}

function rawEntries(raw: string | null | undefined): RawEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((e): e is RawEntry => typeof e === 'object' && e !== null)
      : [];
  } catch {
    return [];
  }
}

export function parseBucketConfiguration(raw: string | null | undefined): BucketFilterConfig[] {
  return rawEntries(raw).map((e) => ({
    title: typeof e.title === 'string' ? e.title : '',
    filter: typeof e.filter?.filter === 'string' ? e.filter.filter : '',
    includeNulls: e.filter?.filter_include_nulls === true,
  }));
}

/**
 * The JSON to store. Fields the editor doesn't surface (a timezone or search
 * term on the filter, say) are carried over from the entry at the same index
 * in `previousRaw`, so saving never silently drops server-side data.
 */
export function serializeBucketConfiguration(
  configs: BucketFilterConfig[],
  previousRaw?: string | null,
): string {
  const previous = rawEntries(previousRaw);
  return JSON.stringify(
    configs.map((c, i) => {
      const base = previous[i];
      return {
        ...base,
        title: c.title.trim(),
        filter: {
          ...(base?.filter ?? {}),
          filter: c.filter.trim(),
          filter_include_nulls: c.includeNulls,
        },
      };
    }),
  );
}

/** A message describing the first problem with a filter-mode config, or null. */
export function validateBucketConfiguration(configs: BucketFilterConfig[]): string | null {
  if (configs.length === 0) return 'Add at least one bucket.';
  for (const [i, c] of configs.entries()) {
    if (!c.title.trim()) return `Bucket ${i + 1} needs a title.`;
    if (c.filter.trim()) {
      try {
        parseFilterQuery(c.filter, new Date());
      } catch (err) {
        return `Bucket “${c.title.trim()}”: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }
  return null;
}
