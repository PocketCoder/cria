import './mocks';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { createTask, getTaskByLocalId } from '@/db/tasks';
import { useUi } from '@/stores/ui';
import { renderWithProviders, resetDb, signIn } from './render';
import { seedProject } from '../unit/_helpers';

let taskId = '';

beforeEach(async () => {
  await resetDb();
  signIn();
  const projectId = await seedProject(1, 'Home');
  const task = await createTask({ title: 'Fix the shelf', projectLocalId: projectId });
  taskId = task.localId;
});

describe('TaskDetail smoke', () => {
  it('renders nothing when no task is selected', () => {
    renderWithProviders(<TaskDetail />);
    expect(screen.queryByRole('complementary', { name: 'Task details' })).not.toBeInTheDocument();
  });

  it('shows the selected task in the inspector', async () => {
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    expect(await screen.findByRole('heading', { name: 'Fix the shelf' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Task details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close details' })).toBeInTheDocument();
  });

  it('renames the task by editing the title', async () => {
    const user = userEvent.setup();
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    await user.click(await screen.findByRole('heading', { name: 'Fix the shelf' }));
    const input = await screen.findByDisplayValue('Fix the shelf');
    await user.clear(input);
    await user.type(input, 'Fix the shelf properly{Enter}');

    await waitFor(async () => {
      expect((await getTaskByLocalId(taskId))?.title).toBe('Fix the shelf properly');
    });
  });

  it('toggles favourite', async () => {
    const user = userEvent.setup();
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    await user.click(await screen.findByRole('button', { name: 'Favourite' }));
    await waitFor(async () => {
      expect((await getTaskByLocalId(taskId))?.isFavorite).toBe(true);
    });
  });

  it('closes via the close button and via Escape', async () => {
    const user = userEvent.setup();
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    // Wait for the loaded card: the loading placeholder has its own close button.
    await screen.findByRole('heading', { name: 'Fix the shelf' });
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(useUi.getState().selectedTaskLocalId).toBeNull());

    useUi.setState({ selectedTaskLocalId: taskId });
    await screen.findByRole('heading', { name: 'Fix the shelf' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(useUi.getState().selectedTaskLocalId).toBeNull());
  });
});
