import './mocks';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BucketHeader } from '@/features/kanban/KanbanColumn';
import type { Bucket } from '@/domain/bucket';
import type { ProjectView } from '@/domain/view';

const bucket = (title: string): Bucket => ({
  localId: 'b1',
  serverId: 1,
  viewLocalId: 'v1',
  title,
  position: 0,
  limit: 0,
  createdByServerId: null,
  updatedAt: '2026-01-01T00:00:00Z',
});

function header(title: string) {
  return (
    <BucketHeader
      bucket={bucket(title)}
      view={{ localId: 'v1' } as ProjectView}
      taskCount={0}
      isDoneBucket={false}
      isDefaultBucket={false}
      atLimit={false}
      collapsed={false}
      onToggleCollapse={() => undefined}
    />
  );
}

async function startRename(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Bucket options' }));
  await user.click(screen.getByRole('button', { name: /Rename/ }));
  return screen.getByRole('textbox', { name: 'Bucket name' });
}

describe('BucketHeader rename draft', () => {
  it('focuses the input and starts from the current title', async () => {
    const user = userEvent.setup();
    render(header('Backlog'));
    const input = await startRename(user);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Backlog');
  });

  it('forgets an abandoned edit and picks up a renamed bucket', async () => {
    const user = userEvent.setup();
    const { rerender } = render(header('Backlog'));
    const input = await startRename(user);
    await user.type(input, ' typo');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Bucket name' })).not.toBeInTheDocument();

    rerender(header('Todo'));
    expect(await startRename(user)).toHaveValue('Todo');
  });
});
