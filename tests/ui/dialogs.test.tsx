import './mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictModal } from '@/components/ConflictModal';
import { OutboxModal } from '@/components/OutboxModal';
import { LabelManagerModal } from '@/components/LabelManagerModal';
import { SavedFilterModal } from '@/features/smart-views/SavedFilterModal';
import { ViewManagerModal } from '@/features/projects/ViewManagerModal';
import { renderWithProviders, resetDb, signIn } from './render';

beforeEach(async () => {
  await resetDb();
  signIn();
});

const cases: Array<{ name: string; label: string | RegExp; ui: (onClose: () => void) => React.ReactElement }> = [
  { name: 'ConflictModal', label: /changed in two places/, ui: (c) => <ConflictModal onClose={c} /> },
  { name: 'OutboxModal', label: 'Sync queue', ui: (c) => <OutboxModal onClose={c} /> },
  { name: 'LabelManagerModal', label: 'Manage labels', ui: (c) => <LabelManagerModal onClose={c} /> },
  { name: 'SavedFilterModal', label: 'New filter', ui: (c) => <SavedFilterModal onClose={c} /> },
  {
    name: 'ViewManagerModal',
    label: 'Manage views',
    ui: (c) => (
      <ViewManagerModal
        projectLocalId="proj_1"
        activeViewLocalId={undefined}
        onSelectView={() => undefined}
        onClose={c}
      />
    ),
  },
];

describe.each(cases)('$name as a native modal dialog', ({ label, ui }) => {
  it('is a named, open <dialog>', async () => {
    renderWithProviders(ui(() => undefined));
    const dialog = await screen.findByRole('dialog', { name: label });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
  });

  it('closes on Escape (cancel) and on a backdrop click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = renderWithProviders(ui(onClose));
    const dialog = await screen.findByRole('dialog', { name: label });

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector('button[aria-hidden="true"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves initial focus inside the dialog', async () => {
    renderWithProviders(ui(() => undefined));
    const dialog = await screen.findByRole('dialog', { name: label });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Escape inside a dialog', () => {
  it('cancels a label add without dismissing the label manager', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<LabelManagerModal onClose={onClose} />);
    await user.click(await screen.findByRole('button', { name: /add label|new label/i }));
    const input = await screen.findByRole('textbox', { name: 'New label name' });

    const esc = createEvent.keyDown(input, { key: 'Escape' });
    fireEvent(input, esc);
    // preventDefault stops the browser firing `cancel` on the dialog.
    expect(esc.defaultPrevented).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'New label name' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
