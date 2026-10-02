import './mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { extractListItems, createTasksFromItems } = vi.hoisted(() => ({
  extractListItems: vi.fn(),
  createTasksFromItems: vi.fn(),
}));

vi.mock('@/features/shoppingPhoto/ocr', () => ({ extractListItems }));
vi.mock('@/features/shoppingPhoto/photoItems', async (orig) => ({
  ...(await orig<typeof import('@/features/shoppingPhoto/photoItems')>()),
  createTasksFromItems,
}));
vi.mock('@/queries/projects', () => ({
  useSelectableProjects: () => ({ data: [{ localId: 'p1', title: 'Shopping', hexColor: null }] }),
}));

import { PhotoTaskCreator } from '@/features/shoppingPhoto/PhotoTaskCreator';
import { renderWithProviders } from './render';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  extractListItems.mockReset();
  createTasksFromItems.mockReset();
});

function pickPhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'list.jpg', { type: 'image/jpeg' })] } });
}

describe('PhotoTaskCreator save failure', () => {
  it('stays on the review list with the unsaved items and a partial-save message', async () => {
    const user = userEvent.setup();
    extractListItems.mockResolvedValue({ engine: 'tesseract', items: ['Milk', 'Eggs', 'Bread'] });
    createTasksFromItems.mockImplementation(
      async (chosen: Array<{ id: number }>, _p: string, _l: string, onSaved: (i: { id: number }) => void) => {
        onSaved(chosen[0]!);
        throw new Error('network down');
      },
    );

    const { container } = renderWithProviders(<PhotoTaskCreator onClose={() => undefined} />);
    pickPhoto(container);
    await screen.findByDisplayValue('Milk');
    await user.click(screen.getByRole('button', { name: /^add \d+ tasks?$/i }));

    expect(await screen.findByText('Created 1 of 3 tasks. Please try again for the rest.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try another photo' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Milk')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Eggs')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bread')).toBeInTheDocument();
    // Add is available again for a retry.
    await waitFor(() => expect(screen.getByRole('button', { name: /^add \d+ tasks?$/i })).toBeEnabled());
  });

  it('still shows the error screen when recognition finds nothing', async () => {
    extractListItems.mockResolvedValue({ engine: 'tesseract', items: [] });
    const { container } = renderWithProviders(<PhotoTaskCreator onClose={() => undefined} />);
    pickPhoto(container);
    expect(await screen.findByRole('button', { name: 'Try another photo' })).toBeInTheDocument();
  });
});
