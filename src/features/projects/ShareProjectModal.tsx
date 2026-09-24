import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, Copy, Check, Lock, Loader2 } from 'lucide-react';
import {
  listProjectUsers,
  addProjectUser,
  updateProjectUserPermission,
  removeProjectUser,
  listProjectTeams,
  addProjectTeam,
  updateProjectTeamPermission,
  removeProjectTeam,
  listLinkShares,
  createLinkShare,
  deleteLinkShare,
  PERMISSION_LABELS,
  type Permission,
} from '@/api/projectShares';
import { listTeams } from '@/api/teams';
import { UserSearchCombobox } from '@/components/ui/user-search';
import { shareUrlFor } from '@/lib/shareUrl';
import { useFrontendUrl } from '@/queries/server';
import { getAuthSnapshot } from '@/auth/store';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/cn';
import type { Project } from '@/domain/project';

type Tab = 'users' | 'teams' | 'links';

function PermissionSelect({
  value,
  onChange,
  disabled,
}: {
  value: Permission;
  onChange: (p: Permission) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value) as Permission)}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-1 text-xs outline-none disabled:opacity-50"
    >
      {([0, 1, 2] as Permission[]).map((p) => (
        <option key={p} value={p}>
          {PERMISSION_LABELS[p]}
        </option>
      ))}
    </select>
  );
}

/**
 * Vikunja project sharing: users / teams / link shares, direct API +
 * TanStack Query (online-only, like upstream's web UI).
 */
export function ShareProjectModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('users');
  const online = useOnline();
  const qc = useQueryClient();
  const projectId = project.serverId!;
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['project-shares', projectId] });

  /* users */
  const usersQ = useQuery({
    queryKey: ['project-shares', projectId, 'users'],
    queryFn: () => listProjectUsers(projectId),
    enabled: online,
  });
  const [newUserPermission, setNewUserPermission] = useState<Permission>(0);

  /* teams */
  const teamsQ = useQuery({
    queryKey: ['project-shares', projectId, 'teams'],
    queryFn: () => listProjectTeams(projectId),
    enabled: online && tab === 'teams',
  });
  const allTeamsQ = useQuery({
    queryKey: ['teams'],
    queryFn: () => listTeams(),
    enabled: online && tab === 'teams',
  });
  const [newTeamId, setNewTeamId] = useState<number | ''>('');
  const [newTeamPermission, setNewTeamPermission] = useState<Permission>(0);

  /* links */
  const linksQ = useQuery({
    queryKey: ['project-shares', projectId, 'links'],
    queryFn: () => listLinkShares(projectId),
    enabled: online && tab === 'links',
  });
  const { data: frontendUrl } = useFrontendUrl();
  const [linkName, setLinkName] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkPermission, setLinkPermission] = useState<Permission>(0);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const mutate = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSettled: invalidate,
  });

  const copyShareUrl = async (hash: string) => {
    const { serverUrl } = getAuthSnapshot();
    if (!serverUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrlFor(serverUrl, frontendUrl, hash));
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const err = mutate.error ? String((mutate.error as Error).message ?? mutate.error) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="glass-surface flex max-h-[85vh] w-11/12 max-w-lg flex-col overflow-hidden rounded-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Share “{project.title}”</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex gap-1 border-b border-[var(--color-border)] px-3 pt-2">
          {(['users', 'teams', 'links'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-t-md px-3 py-1.5 text-sm capitalize',
                tab === t
                  ? 'border border-b-0 border-[var(--color-border)] bg-[var(--color-card)] font-medium'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
              )}
            >
              {t === 'links' ? 'Share links' : t}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!online && (
            <p className="text-xs text-[var(--color-warning,#b45309)]">
              You're offline — sharing needs a connection.
            </p>
          )}
          {err && <p className="text-xs text-[var(--color-destructive)]">{err}</p>}

          {tab === 'users' && (
            <>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <UserSearchCombobox
                    placeholder="Add a user…"
                    onSelect={(u) =>
                      mutate.mutate(() =>
                        addProjectUser(projectId, u.username, newUserPermission),
                      )
                    }
                  />
                </div>
                <PermissionSelect value={newUserPermission} onChange={setNewUserPermission} />
              </div>
              <ul className="space-y-1">
                {(usersQ.data ?? []).map((u) => (
                  <li
                    key={u.serverId}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {u.name || u.username}
                      <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)]">
                        @{u.username}
                      </span>
                    </span>
                    <PermissionSelect
                      value={u.permission}
                      disabled={!online}
                      onChange={(p) =>
                        mutate.mutate(() =>
                          updateProjectUserPermission(projectId, u.serverId, p),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${u.username}`}
                      onClick={() =>
                        mutate.mutate(() => removeProjectUser(projectId, u.serverId))
                      }
                      className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {usersQ.isSuccess && usersQ.data.length === 0 && (
                  <p className="py-2 text-center text-xs text-[var(--color-muted-foreground)]">
                    Not shared with any users yet.
                  </p>
                )}
              </ul>
            </>
          )}

          {tab === 'teams' && (
            <>
              <div className="flex items-center gap-2">
                <select
                  value={newTeamId}
                  onChange={(e) => setNewTeamId(e.target.value ? Number(e.target.value) : '')}
                  className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
                >
                  <option value="">Select a team…</option>
                  {(allTeamsQ.data ?? [])
                    .filter((t) => !(teamsQ.data ?? []).some((s) => s.serverId === t.serverId))
                    .map((t) => (
                      <option key={t.serverId} value={t.serverId}>
                        {t.name}
                      </option>
                    ))}
                </select>
                <PermissionSelect value={newTeamPermission} onChange={setNewTeamPermission} />
                <button
                  type="button"
                  disabled={newTeamId === '' || !online}
                  onClick={() => {
                    if (newTeamId === '') return;
                    mutate.mutate(() => addProjectTeam(projectId, newTeamId, newTeamPermission));
                    setNewTeamId('');
                  }}
                  className="rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              <ul className="space-y-1">
                {(teamsQ.data ?? []).map((t) => (
                  <li
                    key={t.serverId}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <PermissionSelect
                      value={t.permission}
                      disabled={!online}
                      onChange={(p) =>
                        mutate.mutate(() =>
                          updateProjectTeamPermission(projectId, t.serverId, p),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${t.name}`}
                      onClick={() =>
                        mutate.mutate(() => removeProjectTeam(projectId, t.serverId))
                      }
                      className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {teamsQ.isSuccess && teamsQ.data.length === 0 && (
                  <p className="py-2 text-center text-xs text-[var(--color-muted-foreground)]">
                    Not shared with any teams yet.
                  </p>
                )}
              </ul>
            </>
          )}

          {tab === 'links' && (
            <>
              <div className="space-y-2 rounded-md border border-[var(--color-border)] p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    placeholder="Name (optional)"
                    className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
                  />
                  <PermissionSelect value={linkPermission} onChange={setLinkPermission} />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={linkPassword}
                    onChange={(e) => setLinkPassword(e.target.value)}
                    placeholder="Password (optional)"
                    className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
                  />
                  <button
                    type="button"
                    disabled={!online || mutate.isPending}
                    onClick={() => {
                      mutate.mutate(() =>
                        createLinkShare(projectId, {
                          permission: linkPermission,
                          name: linkName.trim() || undefined,
                          password: linkPassword || undefined,
                        }),
                      );
                      setLinkName('');
                      setLinkPassword('');
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
                  >
                    {mutate.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Create link
                  </button>
                </div>
              </div>
              <ul className="space-y-1">
                {(linksQ.data ?? []).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {s.name || `Link #${s.id}`}
                      <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)]">
                        {PERMISSION_LABELS[s.permission]}
                      </span>
                      {s.hasPassword && (
                        <Lock className="ml-1 inline h-3 w-3 text-[var(--color-muted-foreground)]" />
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label="Copy share link"
                      onClick={() => void copyShareUrl(s.hash)}
                      className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    >
                      {copiedHash === s.hash ? (
                        <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete share link"
                      onClick={() => mutate.mutate(() => deleteLinkShare(projectId, s.id))}
                      className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {linksQ.isSuccess && linksQ.data.length === 0 && (
                  <p className="py-2 text-center text-xs text-[var(--color-muted-foreground)]">
                    No share links yet.
                  </p>
                )}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
