// Smoke test for the view manager: each action reaches the outbox in order,
// deleting the active view switches away first, and the last-view and
// placeholder guards disable the matching controls.

import './mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewManagerModal } from '@/features/projects/ViewManagerModal';
import { replaceViewsForProjectFromServer, listViewsForProject } from '@/db/views';
import { getDb } from '@/db';
import { seedProject } from '../unit/_helpers';
import { renderWithProviders, resetDb, signIn } from './render';

beforeEach(async () => {
  await resetDb();
  signIn();
});

describe('ViewManagerModal', () => {
  it('renames, adds, deletes with confirm and switches away from the active view', async () => {
    const user = userEvent.setup();
    const p = await seedProject(1);
    await replaceViewsForProjectFromServer(p, [
      { id: 11, title: 'List', project_id: 1, view_kind: 'list', position: 100 },
      { id: 12, title: 'Kanban', project_id: 1, view_kind: 'kanban', position: 200 },
    ] as any);
    const views = await listViewsForProject(p);
    const onSelect = vi.fn();
    renderWithProviders(
      <ViewManagerModal projectLocalId={p} activeViewLocalId={views[0]!.localId} onSelectView={onSelect} onClose={() => undefined} />,
    );
    await screen.findByText('Kanban');

    await user.click(screen.getByRole('button', { name: 'Rename List' }));
    const input = screen.getByRole('textbox', { name: 'View name' });
    await user.clear(input);
    await user.type(input, 'Backlog{Enter}');
    await screen.findByText('Backlog');

    await user.click(screen.getByRole('button', { name: 'Add view' }));
    await user.type(screen.getByRole('textbox', { name: 'New view name' }), 'Roadmap');
    await user.click(screen.getAllByRole('button', { name: 'Add view' }).at(-1)!);
    await screen.findByText('Roadmap');

    await user.click(screen.getByRole('button', { name: 'Delete Backlog' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Backlog')).not.toBeInTheDocument());
    expect(onSelect).toHaveBeenCalledWith(views[1]!.localId);

    const db = await getDb();
    const ops = await db.select<{ op: string }[]>(`SELECT op FROM outbox WHERE entity_type='view' ORDER BY id`);
    expect(ops.map((o) => o.op)).toEqual(['update', 'create', 'delete']);
  });

  it('disables rename, reorder and delete on local placeholders', async () => {
    const p = await seedProject(2);
    renderWithProviders(
      <ViewManagerModal projectLocalId={p} activeViewLocalId={undefined} onSelectView={() => undefined} onClose={() => undefined} />,
    );
    await screen.findByText(/once this project has synced/);
    expect(screen.getByRole('button', { name: 'Delete List' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename List' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reorder List' })).toBeDisabled();
  });

  it('disables delete on the only view', async () => {
    const p = await seedProject(3);
    await replaceViewsForProjectFromServer(p, [
      { id: 31, title: 'List', project_id: 3, view_kind: 'list', position: 100 },
    ] as any);
    renderWithProviders(
      <ViewManagerModal projectLocalId={p} activeViewLocalId={undefined} onSelectView={() => undefined} onClose={() => undefined} />,
    );
    await screen.findByText('List');
    expect(screen.getByRole('button', { name: 'Delete List' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename List' })).toBeEnabled();
  });
});
