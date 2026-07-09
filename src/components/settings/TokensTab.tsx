import { useState, useEffect } from 'react';
import {
  listApiTokens,
  createApiToken,
  deleteApiToken,
  listApiRoutes,
  listCaldavTokens,
  createCaldavToken,
  deleteCaldavToken,
  type ApiToken,
  type CaldavToken,
  type ApiRouteGroup,
} from '@/api/account';
import { routesToGroups, selectionToPermissions } from '@/lib/apiTokenPermissions';
import { Button } from '@/components/ui/button';

interface Props {
  disabled?: boolean;
}

export function TokensTab({ disabled }: Props) {
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [caldavTokens, setCaldavTokens] = useState<CaldavToken[]>([]);
  const [routes, setRoutes] = useState<ApiRouteGroup[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      listApiTokens().then(setApiTokens).catch(() => {}),
      listCaldavTokens().then(setCaldavTokens).catch(() => {}),
      listApiRoutes().then(setRoutes).catch(() => {}),
    ]);
  }, []);

  const handleCreate = async () => {
    setError('');
    try {
      const permissions = selectionToPermissions([...selectedPerms]);
      const result = await createApiToken({
        title: newTitle,
        expires_at: newExpiry || undefined,
        permissions: Object.keys(permissions).length ? permissions : undefined,
      });
      setNewTokenValue(result.token ?? null);
      setShowCreateForm(true);
      await listApiTokens().then(setApiTokens).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteApiToken(id);
      await listApiTokens().then(setApiTokens).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleCaldavCreate = async () => {
    try {
      const result = await createCaldavToken();
      setNewTokenValue(result.token ?? null);
      await listCaldavTokens().then(setCaldavTokens).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleCaldavDelete = async (id: number) => {
    try {
      await deleteCaldavToken(id);
      await listCaldavTokens().then(setCaldavTokens).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copyToken = () => {
    if (newTokenValue) {
      void navigator.clipboard.writeText(newTokenValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-red-500">{error}</p>}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">API Tokens</h3>
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
          {apiTokens.length === 0 && !showCreateForm && (
            <p className="text-sm text-[var(--color-muted-foreground)]">No API tokens yet.</p>
          )}
          {apiTokens
            .filter((t) => t.id)
            .map((token) => (
              <div key={token.id} className="flex items-center justify-between rounded bg-[var(--color-muted)] px-2 py-1">
                <div>
                  <span className="text-sm">{token.title}</span>
                  {token.expires_at && (
                    <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">
                      expires {new Date(token.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Button variant="destructive" size="sm" onClick={() => void handleDelete(token.id!)} disabled={disabled}>
                  Delete
                </Button>
              </div>
            ))}

          {!showCreateForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowCreateForm(true)} disabled={disabled}>
              + New API Token
            </Button>
          ) : newTokenValue ? (
            <div className="space-y-2">
              <p className="text-xs text-green-500">Token created — copy it now, it won't be shown again.</p>
              <div className="flex gap-2">
                <code className="flex-1 rounded bg-[var(--color-muted)] px-2 py-1 text-xs break-all">{newTokenValue}</code>
                <Button size="sm" onClick={copyToken}>{copied ? 'Copied!' : 'Copy'}</Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setShowCreateForm(false); setNewTokenValue(null); setNewTitle(''); setNewExpiry(''); setSelectedPerms(new Set()); setCopied(false); }}>
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Token description"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
              />
              <input
                type="date"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
              />
              {routes.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-[var(--color-muted-foreground)]">Permissions (optional):</p>
                  {routesToGroups(routes).map((group) => (
                    <div key={group.group} className="mb-2">
                      <p className="text-xs font-medium capitalize">{group.group}</p>
                      <div className="flex flex-wrap gap-2">
                        {group.permissions.map((perm) => (
                          <label key={perm.id} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={selectedPerms.has(perm.id)}
                              onChange={() => {
                                const next = new Set(selectedPerms);
                                if (next.has(perm.id)) next.delete(perm.id);
                                else next.add(perm.id);
                                setSelectedPerms(next);
                              }}
                            />
                            {perm.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleCreate()} disabled={disabled || !newTitle.trim()}>
                  Create
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">CalDAV Tokens</h3>
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
          {caldavTokens.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">No CalDAV tokens yet.</p>
          )}
          {caldavTokens
            .filter((t) => t.id)
            .map((token) => (
              <div key={token.id} className="flex items-center justify-between rounded bg-[var(--color-muted)] px-2 py-1">
                <span className="text-sm">Token #{token.id}</span>
                <Button variant="destructive" size="sm" onClick={() => void handleCaldavDelete(token.id!)} disabled={disabled}>
                  Delete
                </Button>
              </div>
            ))}
          <Button variant="outline" size="sm" onClick={() => void handleCaldavCreate()} disabled={disabled}>
            + Generate CalDAV Token
          </Button>
        </div>
      </section>
    </div>
  );
}
