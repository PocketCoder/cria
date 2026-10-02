import './mocks';
import { Profiler } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    await user.click(await screen.findByRole('button', { name: 'Fix the shelf' }));
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

describe('TaskDetail subtasks block', () => {
  it('settles after mount without a render loop', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
    let commits = 0;
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(
      <Profiler id="detail" onRender={() => (commits += 1)}>
        <TaskDetail />
      </Profiler>,
    );
    await screen.findByRole('heading', { name: 'Fix the shelf' });
    await screen.findByText('Subtasks');
    // Let queries, effects and any timers drain, then confirm nothing keeps rendering.
    await new Promise((r) => setTimeout(r, 300));
    const settled = commits;
    await new Promise((r) => setTimeout(r, 300));
    spy.mockRestore();

    expect(commits).toBe(settled);
    expect(commits).toBeLessThan(40);
    expect(errors.filter((e) => e.includes('Maximum update depth'))).toEqual([]);
  });
});
