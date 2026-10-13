import './mocks';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { QuickAddModal } from '@/components/QuickAddModal';
import { UndoToasts } from '@/components/UndoToast';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import type { Task } from '@/domain/task';
import { renderWithProviders, resetDb, signIn } from './render';

// A modal dialog makes the rest of the page inert, so overlays that must stay
// usable above one have to render inside the topmost dialog.

const task = { localId: 't1', title: 'Water plants' } as Task;

function queueDelete() {
  act(() => usePendingDeletes.setState({ pending: { t1: { task, enqueuedAt: Date.now() } } }));
}

beforeEach(async () => {
  await resetDb();
  signIn();
  usePendingDeletes.setState({ pending: {} });
});

function Host({ withQuickAdd }: { withQuickAdd?: boolean }) {
  const [quickAdd, setQuickAdd] = useState(false);
  const [sheet, setSheet] = useState(true);
  return (
    <>
      <UndoToasts />
      {sheet ? (
        <ModalDialog label="Sheet" onClose={() => setSheet(false)}>
          <button type="button" onClick={() => setQuickAdd(true)}>
            Quick add
          </button>
        </ModalDialog>
      ) : null}
      {withQuickAdd && quickAdd ? <QuickAddModal onClose={() => setQuickAdd(false)} /> : null}
    </>
  );
}

describe('overlays above an open modal dialog', () => {
  it('keeps the undo toast inside the topmost dialog, and back on the page once none is open', async () => {
    renderWithProviders(<Host />);
    queueDelete();

    const sheet = screen.getByRole('dialog', { name: 'Sheet' });
    expect(sheet).toContainElement(screen.getByRole('button', { name: /Undo/ }));

    act(() => {
      (sheet as HTMLDialogElement).close();
    });
    // The browser's `close` event is async; the host unmounts the dialog on it.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Undo/ }).closest('dialog')).toBeNull();
  });

  it('stacks quick-add above another dialog, with its pickers and the toast inside it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host withQuickAdd />);
    queueDelete();

    await user.click(screen.getByRole('button', { name: 'Quick add' }));
    const quickAdd = await screen.findByRole('dialog', { name: 'Add task' });
    expect([...document.querySelectorAll('dialog[open]')].at(-1)).toBe(quickAdd);
    expect(quickAdd).toContainElement(screen.getByRole('button', { name: /Undo/ }));

    await user.click(screen.getByText(/\+ Priority, labels/));
    const priority = await screen.findByRole('button', { name: /^Priority/ });
    expect(quickAdd).toContainElement(priority);
  });

  it('renders the toast in place when no dialog is open', () => {
    const { container } = render(<UndoToasts />);
    expect(container).toBeEmptyDOMElement();
    queueDelete();
    expect(container).toContainElement(screen.getByRole('status'));
  });
});
