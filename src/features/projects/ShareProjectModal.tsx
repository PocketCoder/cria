import { useState } from 'react';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { LabeledInput } from '@/components/ui/labeled-input';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
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
import {
  availableTeams,
  buildLinkShareInput,
  parseTeamSelection,
  shareErrorMessage,
} from './shareLogic';

type Tab = 'users' | 'teams' | 'links';
type Mutate = UseMutationResult<void, Error, () => Promise<void>>;

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
      aria-label="Permission"
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
  // All hooks before any early return — React's hook-order rule. projectId
  // can be null (project not yet synced); every hook below guards on it via
  // `enabled` instead of skipping the hook call itself.
  const [tab, setTab] = useState<Tab>('users');
  const online = useOnline();
  const qc = useQueryClient();
  const projectId = project.serverId;
  const hasProjectId = projectId != null;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['project-shares', projectId] });

  /* users */
  const usersQ = useQuery({
    queryKey: ['project-shares', projectId, 'users'],
    queryFn: () => listProjectUsers(projectId!),
    enabled: online && hasProjectId,
  });
  const [newUserPermission, setNewUserPermission] = useState<Permission>(0);

  /* teams */
  const teamsQ = useQuery({
    queryKey: ['project-shares', projectId, 'teams'],
    queryFn: () => listProjectTeams(projectId!),
    enabled: online && hasProjectId && tab === 'teams',
  });
  const allTeamsQ = useQuery({
    queryKey: ['teams'],
    queryFn: () => listTeams(),
    enabled: online && hasProjectId && tab === 'teams',
  });
  const [newTeamId, setNewTeamId] = useState<number | ''>('');
  const [newTeamPermission, setNewTeamPermission] = useState<Permission>(0);

  /* links */
  const linksQ = useQuery({
    queryKey: ['project-shares', projectId, 'links'],
    queryFn: () => listLinkShares(projectId!),
    enabled: online && hasProjectId && tab === 'links',
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

  const err = shareErrorMessage(mutate.error);

  if (projectId == null) {
    return <UnsyncedNotice onClose={onClose} />;
  }

  return (
    <ModalDialog label={`Share “${project.title}”`} onClose={onClose}>
      <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <BackdropDismiss onDismiss={onClose} />
      <div
        className="relative bg-[var(--color-card)] border border-[var(--color-border)] flex max-h-[85vh] w-11/12 max-w-lg flex-col overflow-hidden rounded-lg shadow-lg"
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

        <TabBar tab={tab} onChange={setTab} />

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!online && (
            <p className="text-xs text-[var(--color-warning,#b45309)]">
              You're offline — sharing needs a connection.
            </p>
          )}
          {err && <p className="text-xs text-[var(--color-destructive)]">{err}</p>}

          {tab === 'users' && (
            <UsersPanel
              projectId={projectId}
              online={online}
              mutate={mutate}
              users={usersQ.data}
              loaded={usersQ.isSuccess}
              newPermission={newUserPermission}
              setNewPermission={setNewUserPermission}
            />
          )}

          {tab === 'teams' && (
            <TeamsPanel
              projectId={projectId}
              online={online}
              mutate={mutate}
              shared={teamsQ.data}
              sharedLoaded={teamsQ.isSuccess}
              allTeams={allTeamsQ.data}
              newTeamId={newTeamId}
              setNewTeamId={setNewTeamId}
              newPermission={newTeamPermission}
              setNewPermission={setNewTeamPermission}
            />
          )}

          {tab === 'links' && (
            <LinksPanel
              projectId={projectId}
              online={online}
              mutate={mutate}
              links={linksQ.data}
              loaded={linksQ.isSuccess}
              name={linkName}
              setName={setLinkName}
              password={linkPassword}
              setPassword={setLinkPassword}
              permission={linkPermission}
              setPermission={setLinkPermission}
              copiedHash={copiedHash}
              onCopy={(hash) => void copyShareUrl(hash)}
            />
          )}
        </div>
      </div>
      </div>
    </ModalDialog>
  );
}

function UnsyncedNotice({ onClose }: { onClose: () => void }) {
  return (
    <ModalDialog label="Share project" onClose={onClose}>
      <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <BackdropDismiss onDismiss={onClose} />
      <div
        className="relative bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 shadow-lg"
      >
        <p className="text-sm">Sync this project before sharing it.</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)]"
        >
          Close
        </button>
      </div>
      </div>
    </ModalDialog>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-1 border-b border-[var(--color-border)] px-3 pt-2">
      {(['users', 'teams', 'links'] as Tab[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
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
  );
}

const ROW_CLASS =
  'flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-2.5 py-1.5';
const REMOVE_CLASS =
  'rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]';
const EMPTY_CLASS = 'py-2 text-center text-xs text-[var(--color-muted-foreground)]';

type UserShares = Awaited<ReturnType<typeof listProjectUsers>>;
type TeamShares = Awaited<ReturnType<typeof listProjectTeams>>;
type AllTeams = Awaited<ReturnType<typeof listTeams>>;
type LinkShares = Awaited<ReturnType<typeof listLinkShares>>;

interface PanelBase {
  projectId: number;
  online: boolean;
  mutate: Mutate;
}

function UsersPanel({
  projectId,
  online,
  mutate,
  users,
  loaded,
  newPermission,
  setNewPermission,
}: PanelBase & {
  users: UserShares | undefined;
  loaded: boolean;
  newPermission: Permission;
  setNewPermission: (p: Permission) => void;
}) {
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <UserSearchCombobox
            placeholder="Add a user…"
            onSelect={(u) =>
              mutate.mutate(() => addProjectUser(projectId, u.username, newPermission))
            }
          />
        </div>
        <PermissionSelect value={newPermission} onChange={setNewPermission} />
      </div>
      <ul className="space-y-1">
        {(users ?? []).map((u) => (
          <li key={u.serverId} className={ROW_CLASS}>
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
                mutate.mutate(() => updateProjectUserPermission(projectId, u.serverId, p))
              }
            />
            <button
              type="button"
              aria-label={`Remove ${u.username}`}
              onClick={() => mutate.mutate(() => removeProjectUser(projectId, u.serverId))}
              className={REMOVE_CLASS}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {loaded && users?.length === 0 && (
          <p className={EMPTY_CLASS}>Not shared with any users yet.</p>
        )}
      </ul>
    </>
  );
}

function TeamsPanel({
  projectId,
  online,
  mutate,
  shared,
  sharedLoaded,
  allTeams,
  newTeamId,
  setNewTeamId,
  newPermission,
  setNewPermission,
}: PanelBase & {
  shared: TeamShares | undefined;
  sharedLoaded: boolean;
  allTeams: AllTeams | undefined;
  newTeamId: number | '';
  setNewTeamId: (id: number | '') => void;
  newPermission: Permission;
  setNewPermission: (p: Permission) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <select
          aria-label="Team"
          value={newTeamId}
          onChange={(e) => setNewTeamId(parseTeamSelection(e.target.value))}
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
        >
          <option value="">Select a team…</option>
          {availableTeams(allTeams, shared).map((t) => (
            <option key={t.serverId} value={t.serverId}>
              {t.name}
            </option>
          ))}
        </select>
        <PermissionSelect value={newPermission} onChange={setNewPermission} />
        <button
          type="button"
          disabled={newTeamId === '' || !online}
          onClick={() => {
            if (newTeamId === '') return;
            mutate.mutate(() => addProjectTeam(projectId, newTeamId, newPermission));
            setNewTeamId('');
          }}
          className="rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <ul className="space-y-1">
        {(shared ?? []).map((t) => (
          <li key={t.serverId} className={ROW_CLASS}>
            <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
            <PermissionSelect
              value={t.permission}
              disabled={!online}
              onChange={(p) =>
                mutate.mutate(() => updateProjectTeamPermission(projectId, t.serverId, p))
              }
            />
            <button
              type="button"
              aria-label={`Remove ${t.name}`}
              onClick={() => mutate.mutate(() => removeProjectTeam(projectId, t.serverId))}
              className={REMOVE_CLASS}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {sharedLoaded && shared?.length === 0 && (
          <p className={EMPTY_CLASS}>Not shared with any teams yet.</p>
        )}
      </ul>
    </>
  );
}

function LinksPanel({
  projectId,
  online,
  mutate,
  links,
  loaded,
  name,
  setName,
  password,
  setPassword,
  permission,
  setPermission,
  copiedHash,
  onCopy,
}: PanelBase & {
  links: LinkShares | undefined;
  loaded: boolean;
  name: string;
  setName: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  permission: Permission;
  setPermission: (p: Permission) => void;
  copiedHash: string | null;
  onCopy: (hash: string) => void;
}) {
  return (
    <>
      <div className="space-y-2 rounded-md border border-[var(--color-border)] p-2.5">
        <div className="flex items-center gap-2">
          <LabeledInput
            label="Link name"
            className="flex-1"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
          />
          <PermissionSelect value={permission} onChange={setPermission} />
        </div>
        <div className="flex items-end gap-2">
          <LabeledInput
            label="Link password"
            className="flex-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (optional)"
            inputClassName="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            disabled={!online || mutate.isPending}
            onClick={() => {
              mutate.mutate(() =>
                createLinkShare(projectId, buildLinkShareInput(permission, name, password)),
              );
              setName('');
              setPassword('');
            }}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {mutate.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Create link
          </button>
        </div>
      </div>
      <ul className="space-y-1">
        {(links ?? []).map((s) => (
          <li key={s.id} className={ROW_CLASS}>
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
              onClick={() => onCopy(s.hash)}
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
              className={REMOVE_CLASS}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {loaded && links?.length === 0 && <p className={EMPTY_CLASS}>No share links yet.</p>}
      </ul>
    </>
  );
}
