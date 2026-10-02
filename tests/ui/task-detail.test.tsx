import './mocks';
import { Profiler } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { createTask, getTaskByLocalId, listTasksForProject } from '@/db/tasks';
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

  it('keeps the title a heading with a button and returns focus after editing', async () => {
    const user = userEvent.setup();
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    const heading = await screen.findByRole('heading', { name: 'Fix the shelf' });
    const button = within(heading).getByRole('button', { name: 'Fix the shelf' });
    button.focus();
    await user.keyboard('{Enter}');
    const input = await screen.findByDisplayValue('Fix the shelf');
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fix the shelf' })).toHaveFocus();
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

  it('ignores an Escape that something else already consumed', async () => {
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);
    await screen.findByRole('heading', { name: 'Fix the shelf' });

    const esc = createEvent.keyDown(document.body, { key: 'Escape', cancelable: true });
    esc.preventDefault();
    fireEvent(document.body, esc);
    expect(useUi.getState().selectedTaskLocalId).toBe(taskId);
  });

  it('ignores Escape while a modal dialog is open above the inspector', async () => {
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);
    await screen.findByRole('heading', { name: 'Fix the shelf' });

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(useUi.getState().selectedTaskLocalId).toBe(taskId);

    dialog.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useUi.getState().selectedTaskLocalId).toBeNull();
  });

  it('cancels the subtask search on Escape without closing the inspector', async () => {
    const user = userEvent.setup();
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    await user.click(await screen.findByRole('button', { name: /add subtask/i }));
    const input = await screen.findByRole('textbox', { name: 'Search tasks' });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('textbox', { name: 'Search tasks' })).not.toBeInTheDocument();
    expect(useUi.getState().selectedTaskLocalId).toBe(taskId);
    expect(input).not.toBeInTheDocument();
  });
});

describe('TaskDetail subtasks block', () => {
  it('drops the add-subtask draft when switching to another cached task', async () => {
    const user = userEvent.setup();
    const other = await createTask({
      title: 'Water the plants',
      projectLocalId: (await getTaskByLocalId(taskId))!.projectLocalId,
    });
    renderWithProviders(<TaskDetail />);
    // Visit the other task first so it is cached when we switch back (no loading state).
    act(() => useUi.setState({ selectedTaskLocalId: other.localId }));
    await screen.findByRole('heading', { name: 'Water the plants' });
    act(() => useUi.setState({ selectedTaskLocalId: taskId }));
    await screen.findByRole('heading', { name: 'Fix the shelf' });

    await user.click(await screen.findByRole('button', { name: /add subtask/i }));
    await user.type(await screen.findByRole('textbox', { name: 'Search tasks' }), 'Stray draft');

    act(() => useUi.setState({ selectedTaskLocalId: other.localId }));
    await screen.findByRole('heading', { name: 'Water the plants' });

    expect(screen.queryByRole('textbox', { name: 'Search tasks' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add subtask/i })).toBeInTheDocument();
  });

  it('creates one subtask when Enter is pressed twice in quick succession', async () => {
    const user = userEvent.setup();
    useUi.setState({ selectedTaskLocalId: taskId });
    renderWithProviders(<TaskDetail />);

    await user.click(await screen.findByRole('button', { name: /add subtask/i }));
    const input = await screen.findByRole('textbox', { name: 'Search tasks' });
    await user.type(input, 'Sand the edges');
    // Both presses land before the async create finishes or React re-renders.
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(async () => {
      const tasks = await listTasksForProject((await getTaskByLocalId(taskId))!.projectLocalId);
      expect(tasks.filter((t) => t.title === 'Sand the edges')).toHaveLength(1);
    });
    await waitFor(() => expect(input).toHaveValue(''));
    // Let any stray second create finish before the final count.
    await new Promise((r) => setTimeout(r, 100));
    const tasks = await listTasksForProject((await getTaskByLocalId(taskId))!.projectLocalId);
    expect(tasks.filter((t) => t.title === 'Sand the edges')).toHaveLength(1);
  });

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

describe('TaskDetail repeat row', () => {
  it('shows a monthly repeat and lets it be removed', async () => {
    const user = userEvent.setup();
    const projectId = await seedProject(2, 'Bills');
    // Quick-add monthly: repeatMode 1 with no interval.
    const monthly = await createTask({
      title: 'Pay rent',
      projectLocalId: projectId,
      repeatAfter: 0,
      repeatMode: 1,
    });
    useUi.setState({ selectedTaskLocalId: monthly.localId });
    renderWithProviders(<TaskDetail />);

    const row = await screen.findByRole('button', { name: /^Repeat\s*Monthly$/ });
    await user.click(row);

    expect(await screen.findByRole('button', { name: 'Repeats monthly' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Remove repeat' }));

    await waitFor(async () => {
      const t = await getTaskByLocalId(monthly.localId);
      expect(t?.repeatMode).toBe(0);
      expect(t?.repeatAfter).toBe(0);
    });
  });

  it.each([
    ['From creation date', 0],
    ['From completion date', 2],
  ])('seeds one month when switching a monthly repeat to %s', async (label, mode) => {
    const user = userEvent.setup();
    const projectId = await seedProject(2, 'Bills');
    const monthly = await createTask({
      title: 'Pay rent',
      projectLocalId: projectId,
      repeatAfter: 0,
      repeatMode: 1,
    });
    useUi.setState({ selectedTaskLocalId: monthly.localId });
    renderWithProviders(<TaskDetail />);

    await user.click(await screen.findByRole('button', { name: /^Repeat\s*Monthly$/ }));
    await user.click(await screen.findByRole('button', { name: label }));

    await waitFor(async () => {
      const t = await getTaskByLocalId(monthly.localId);
      expect(t?.repeatMode).toBe(mode);
      expect(t?.repeatAfter).toBe(2_592_000);
    });
  });

  it('clears the interval when switching an interval repeat to monthly', async () => {
    const user = userEvent.setup();
    const projectId = await seedProject(2, 'Bills');
    const weekly = await createTask({
      title: 'Water plants',
      projectLocalId: projectId,
      repeatAfter: 604_800,
      repeatMode: 0,
    });
    useUi.setState({ selectedTaskLocalId: weekly.localId });
    renderWithProviders(<TaskDetail />);

    await user.click(await screen.findByRole('button', { name: /^Repeat\s*Every 7 days$/ }));
    await user.click(await screen.findByRole('button', { name: 'Monthly (same day)' }));

    await waitFor(async () => {
      const t = await getTaskByLocalId(weekly.localId);
      expect(t?.repeatMode).toBe(1);
      expect(t?.repeatAfter).toBe(0);
    });
  });
});
