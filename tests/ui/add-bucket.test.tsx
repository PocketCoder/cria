import './mocks';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const createBucket = vi.hoisted(() => vi.fn());
vi.mock('@/db/buckets', () => ({ createBucket }));

import { AddBucketColumn } from '@/features/kanban/AddBucketColumn';

describe('AddBucketColumn', () => {
  it('creates one column when Enter is pressed twice before the write finishes', async () => {
    let finish: () => void = () => undefined;
    createBucket.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const user = userEvent.setup();
    render(<AddBucketColumn viewLocalId="v1" />);

    await user.click(screen.getByRole('button', { name: /add column/i }));
    const input = screen.getByRole('textbox', { name: 'New bucket name' });
    await user.type(input, 'Review');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(createBucket).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'New bucket name' })).not.toBeInTheDocument(),
    );
  });
});
