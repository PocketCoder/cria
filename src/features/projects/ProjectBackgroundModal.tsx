import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, Search, Trash2, X } from 'lucide-react';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import {
  fetchUnsplashThumb,
  hasBackgroundProvider,
  removeProjectBackground,
  searchUnsplash,
  setUnsplashBackground,
  uploadProjectBackground,
  type UnsplashImage,
} from '@/api/projects';
import { useBackgroundProviders } from '@/queries/server';
import { useOnline } from '@/hooks/useOnline';
import type { Project } from '@/domain/project';
import { projectBackgroundKey, useProjectBackground } from './useProjectBackground';

function UnsplashThumb({ image }: { image: UnsplashImage }) {
  const { data: blob } = useQuery({
    queryKey: ['unsplash-thumb', image.id],
    queryFn: () => fetchUnsplashThumb(image.id),
    staleTime: Infinity,
    retry: false,
  });
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const alt = image.authorName ? `Photo by ${image.authorName}` : 'Unsplash photo';
  return src ? (
    <img src={src} alt={alt} className="h-16 w-full object-cover" />
  ) : (
    <div role="img" aria-label={alt} className="h-16 w-full bg-[var(--color-muted)]" />
  );
}

/** Project background: upload, Unsplash search, remove. Online-only. */
export function ProjectBackgroundModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const serverId = project.serverId;
  const { data: providers } = useBackgroundProviders();
  const canUpload = hasBackgroundProvider(providers, 'upload');
  const canUnsplash = hasBackgroundProvider(providers, 'unsplash');
  const current = useProjectBackground(serverId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnsplashImage[] | null>(null);

  const change = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: projectBackgroundKey(serverId) }),
  });
  const search = useMutation({
    mutationFn: (q: string) => searchUnsplash(q),
    onSuccess: setResults,
  });

  const error = (change.error ?? search.error) as Error | null;
  const busy = change.isPending;
  const disabled = !online || busy || serverId == null;

  return (
    <ModalDialog label={`Background for “${project.title}”`} onClose={onClose}>
      <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[var(--dialog-backdrop)] p-4">
        <BackdropDismiss onDismiss={onClose} />
        <div className="relative dialog-panel flex max-h-[85vh] w-11/12 max-w-lg flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Background for “{project.title}”</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
            {!online && (
              <p className="text-[var(--color-warning-text,#b45309)]">
                You're offline. Backgrounds need a connection.
              </p>
            )}
            {serverId == null && (
              <p className="text-[var(--color-muted-foreground)]">
                This project hasn't synced yet. Try again in a moment.
              </p>
            )}
            {error && (
              <p className="text-[var(--color-destructive)]">{error.message}</p>
            )}

            {current && (
              <img
                src={current}
                alt="Current background"
                className="h-28 w-full rounded-md border border-[var(--color-border)] object-cover"
              />
            )}

            <div className="flex flex-wrap gap-2">
              {canUpload && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file && serverId != null)
                        change.mutate(() => uploadProjectBackground(serverId, file));
                    }}
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 hover:bg-[var(--color-muted)] disabled:opacity-50"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    Upload image
                  </button>
                </>
              )}
              {current && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    serverId != null &&
                    change.mutate(() => removeProjectBackground(serverId))
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
              {busy && <Loader2 className="h-4 w-4 animate-spin self-center" />}
            </div>

            {providers && !canUpload && !canUnsplash && (
              <p className="text-[var(--color-muted-foreground)]">
                This server has no background providers enabled.
              </p>
            )}

            {canUnsplash && (
              <section className="space-y-2">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (query.trim()) search.mutate(query.trim());
                  }}
                >
                  <input
                    aria-label="Search Unsplash"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Unsplash"
                    className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!online || search.isPending || !query.trim()}
                    aria-label="Search"
                    className="rounded-md border border-[var(--color-border)] px-2 hover:bg-[var(--color-muted)] disabled:opacity-50"
                  >
                    {search.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                  </button>
                </form>
                {results && results.length === 0 && (
                  <p className="text-[var(--color-muted-foreground)]">No results.</p>
                )}
                {results && results.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2">
                    {results.map((img) => (
                      <li key={img.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          title={img.authorName ? `Photo by ${img.authorName}` : undefined}
                          onClick={() =>
                            serverId != null &&
                            change.mutate(() => setUnsplashBackground(serverId, img))
                          }
                          className="block w-full overflow-hidden rounded-md border border-[var(--color-border)] disabled:opacity-50"
                        >
                          <UnsplashThumb image={img} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
