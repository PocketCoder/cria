import './mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAddModal } from '@/components/QuickAddModal';
import { listTasksForProject } from '@/db/tasks';
import { useUi } from '@/stores/ui';
import { renderWithProviders, resetDb, signIn } from './render';
import { seedProject } from '../unit/_helpers';

let projectId = '';

beforeEach(async () => {
  await resetDb();
  signIn();
  projectId = await seedProject(1, 'Groceries');
  useUi.setState({ activeView: { kind: 'project', localId: projectId } });
});

describe('QuickAddModal smoke', () => {
  it('renders the title field focused', async () => {
    renderWithProviders(<QuickAddModal onClose={() => undefined} />);
    const title = await screen.findByPlaceholderText(/buy milk|task name/i);
    expect(title).toBeInTheDocument();
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('creates a task in the active project and closes', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<QuickAddModal onClose={onClose} />);

    const title = await screen.findByPlaceholderText(/buy milk|task name/i);
    await user.type(title, 'Buy oat milk');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const tasks = await listTasksForProject(projectId);
    expect(tasks.map((t) => t.title)).toEqual(['Buy oat milk']);
  });

  it('does not create a task from an empty title', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<QuickAddModal onClose={onClose} />);

    const title = await screen.findByPlaceholderText(/buy milk|task name/i);
    await user.click(title);
    await user.keyboard('{Enter}');

    expect(onClose).not.toHaveBeenCalled();
    expect(await listTasksForProject(projectId)).toHaveLength(0);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<QuickAddModal onClose={onClose} />);
    await screen.findByPlaceholderText(/buy milk|task name/i);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
