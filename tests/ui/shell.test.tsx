import './mocks';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { createTask } from '@/db/tasks';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/auth/store';
import { renderWithProviders, resetDb, signIn } from './render';
import { seedProject } from '../unit/_helpers';

beforeEach(async () => {
  await resetDb();
});

describe('App shell smoke', () => {
  it('shows the login screen when unauthenticated', async () => {
    useAuth.setState({ status: { kind: 'unauthenticated' } });
    renderWithProviders(<App />);
    expect(await screen.findByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('renders the shell with projects in the sidebar when signed in', async () => {
    signIn();
    await seedProject(1, 'Groceries');
    renderWithProviders(<App />);

    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('lists a project\'s tasks and opens the inspector on click', async () => {
    signIn();
    const projectId = await seedProject(1, 'Groceries');
    await createTask({ title: 'Oat milk', projectLocalId: projectId });
    useUi.setState({ activeView: { kind: 'project', localId: projectId } });
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(await screen.findByText('Oat milk'));
    expect(await screen.findByRole('complementary', { name: 'Task details' })).toBeInTheDocument();
  });
});
