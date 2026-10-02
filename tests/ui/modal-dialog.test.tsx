import './mocks';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalDialog } from '@/components/ui/modal-dialog';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { useFocusOnMount } from '@/lib/useFocusOnMount';

function Panel({ onClose, focusInput }: { onClose: () => void; focusInput?: boolean }) {
  const focus = useFocusOnMount<HTMLInputElement>();
  return (
    <div className="fixed inset-0 flex">
      <BackdropDismiss onDismiss={onClose} />
      <div className="relative">
        <button type="button" onClick={onClose}>
          Close
        </button>
        <input aria-label="Name" ref={focusInput ? focus : undefined} />
      </div>
    </div>
  );
}

function Harness({ onCloseSpy, focusInput }: { onCloseSpy: () => void; focusInput?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onCloseSpy();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? (
        <ModalDialog label="Demo dialog" onClose={close}>
          <Panel onClose={close} focusInput={focusInput} />
        </ModalDialog>
      ) : null}
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: 'Open' });
  await user.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Demo dialog' }) };
}

describe('ModalDialog', () => {
  it('opens as a named native modal dialog', async () => {
    const user = userEvent.setup();
    render(<Harness onCloseSpy={() => undefined} />);
    const { dialog } = await openDialog(user);
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('data-modal', 'true');
  });

  it('puts initial focus on the first real control, never the click-away layer', async () => {
    const user = userEvent.setup();
    render(<Harness onCloseSpy={() => undefined} />);
    await openDialog(user);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('lets content that focuses itself on mount keep focus', async () => {
    const user = userEvent.setup();
    render(<Harness onCloseSpy={() => undefined} focusInput />);
    await openDialog(user);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('closes on Escape (cancel event) once, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    const { trigger, dialog } = await openDialog(user);

    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on a backdrop click and on its own close button', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Harness onCloseSpy={spy} />);
    await openDialog(user);
    await user.click(container.querySelector('button[aria-hidden="true"]') as HTMLElement);
    expect(spy).toHaveBeenCalledTimes(1);

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('treats a browser-initiated close as a close request', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    const { dialog } = await openDialog(user);
    (dialog as HTMLDialogElement).close();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose again when unmounting closes the dialog', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { unmount } = render(<Harness onCloseSpy={spy} />);
    await openDialog(user);
    unmount();
    expect(spy).not.toHaveBeenCalled();
  });
});
