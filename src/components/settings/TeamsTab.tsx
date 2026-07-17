import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Plus, Shield, Trash2, X } from 'lucide-react';
import {
  listTeams,
  getTeam,
  createTeam,
  renameTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  toggleTeamAdmin,
} from '@/api/teams';
import { UserSearchCombobox } from '@/components/ui/user-search';
import { cn } from '@/lib/cn';

function TeamRow({ teamId, name, disabled }: { teamId: number; name: string; disabled: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => getTeam(teamId),
    enabled: open,
  });

  const mutate = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  return (
    <li className="rounded-md border border-[var(--color-border)]">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse team' : 'Expand team'}
          className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {renaming ? (
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                mutate.mutate(() => renameTeam(teamId, draft.trim()));
                setRenaming(false);
              } else if (e.key === 'Escape') {
                setDraft(name);
                setRenaming(false);
              }
            }}
            onBlur={() => setRenaming(false)}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <button
            type="button"
            className="flex-1 truncate text-left text-sm hover:underline"
            onClick={() => !disabled && setRenaming(true)}
            title="Click to rename"
          >
            {name}
          </button>
        )}
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-xs">
            Delete?
            <button
              type="button"
              onClick={() => mutate.mutate(() => deleteTeam(teamId))}
              className="rounded bg-[var(--color-destructive)] px-1.5 py-0.5 font-medium text-[var(--color-destructive-foreground)]"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded px-1 py-0.5 hover:bg-[var(--color-muted)]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-label={`Delete team ${name}`}
            onClick={() => setConfirmDelete(true)}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 border-t border-[var(--color-border)] p-2">
          {detail.isLoading ? (
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
          ) : (
            <>
              <ul className="space-y-1">
                {(detail.data?.members ?? []).map((m) => (
                  <li key={m.serverId} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {m.name || m.username}
                      <span className="ml-1.5 text-xs text-[var(--color-muted-foreground)]">
                        @{m.username}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      title={m.admin ? 'Team admin — click to demote' : 'Make team admin'}
                      onClick={() =>
                        mutate.mutate(async () => {
                          await toggleTeamAdmin(teamId, m.serverId);
                          await qc.invalidateQueries({ queryKey: ['teams', teamId] });
                        })
                      }
                      className={cn(
                        'rounded p-1 disabled:opacity-50',
                        m.admin
                          ? 'text-[var(--color-primary)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                      )}
                    >
                      <Shield className={cn('h-3.5 w-3.5', m.admin && 'fill-current')} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove ${m.username} from team`}
                      onClick={() =>
                        mutate.mutate(async () => {
                          await removeTeamMember(teamId, m.username);
                          await qc.invalidateQueries({ queryKey: ['teams', teamId] });
                        })
                      }
                      className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              {!disabled && (
                <UserSearchCombobox
                  placeholder="Add a member…"
                  onSelect={(u) =>
                    mutate.mutate(async () => {
                      await addTeamMember(teamId, u.username);
                      await qc.invalidateQueries({ queryKey: ['teams', teamId] });
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Vikunja teams management (upstream /teams pages). Online-only. */
export function TeamsTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => listTeams(), enabled: !disabled });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const create = useMutation({
    mutationFn: (name: string) => createTeam(name),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Teams</h3>
      {disabled && (
        <p className="mb-2 text-xs text-[var(--color-warning,#b45309)]">
          You're offline — team management needs a connection.
        </p>
      )}
      <ul className="space-y-1.5">
        {(teams.data ?? []).map((t) => (
          <TeamRow key={t.serverId} teamId={t.serverId} name={t.name} disabled={disabled} />
        ))}
        {teams.isSuccess && teams.data.length === 0 && (
          <p className="py-2 text-center text-xs text-[var(--color-muted-foreground)]">
            No teams yet. Teams let you share projects with several people at once.
          </p>
        )}
      </ul>
      <div className="mt-2">
        {creating ? (
          <input
            type="text"
            autoFocus
            value={newName}
            placeholder="Team name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                create.mutate(newName.trim());
                setNewName('');
                setCreating(false);
              } else if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
            onBlur={() => setCreating(false)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm outline-none"
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New team
          </button>
        )}
      </div>
    </section>
  );
}
