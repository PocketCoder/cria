import './mocks';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('does not call onClose again when unmounting closes the dialog', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { unmount } = render(<Harness onCloseSpy={spy} />);
    await openDialog(user);
    unmount();
    expect(spy).not.toHaveBeenCalled();
  });

  it('stays open under StrictMode, ignoring the stale close from the simulated remount', async () => {
    const spy = vi.fn();
    render(
      <StrictMode>
        <ModalDialog label="Demo dialog" onClose={spy}>
          <button type="button">Inside</button>
        </ModalDialog>
      </StrictMode>,
    );
    // Let the queued `close` event from the StrictMode cleanup land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Demo dialog' })).toHaveAttribute('open');
  });
});

describe('ModalDialog without showModal() (Safari / iOS before 15.4)', () => {
  type Proto = Partial<Pick<HTMLDialogElement, 'showModal' | 'close'>>;
  const proto = HTMLDialogElement.prototype as Proto;
  const saved = { showModal: proto.showModal, close: proto.close };

  function simulateOldWebKit() {
    delete proto.showModal;
    delete proto.close;
  }

  afterEach(() => {
    proto.showModal = saved.showModal;
    proto.close = saved.close;
  });

  it('opens as a fixed overlay instead of throwing', async () => {
    simulateOldWebKit();
    const user = userEvent.setup();
    render(<Harness onCloseSpy={() => undefined} />);
    const { dialog } = await openDialog(user);
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('data-modal-fallback');
    expect(dialog).not.toHaveAttribute('data-modal');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('stacks a later dialog above an earlier one', () => {
    simulateOldWebKit();
    render(
      <>
        <ModalDialog label="First" onClose={() => undefined}>
          <button type="button">One</button>
        </ModalDialog>
        <ModalDialog label="Second" onClose={() => undefined}>
          <button type="button">Two</button>
        </ModalDialog>
      </>,
    );
    const z = (name: string) => Number(screen.getByRole('dialog', { name }).style.zIndex);
    expect(z('First')).toBeGreaterThan(0);
    expect(z('Second')).toBeGreaterThan(z('First'));
  });

  it('closes once on Escape keydown, unless a local handler already used it', async () => {
    simulateOldWebKit();
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} focusInput />);
    await openDialog(user);

    const input = screen.getByRole('textbox', { name: 'Name' });
    const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    input.dispatchEvent(used);
    expect(spy).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns focus to the trigger once closed', async () => {
    simulateOldWebKit();
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    const { trigger } = await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it('survives StrictMode remounting', () => {
    simulateOldWebKit();
    render(
      <StrictMode>
        <ModalDialog label="Demo dialog" onClose={() => undefined}>
          <button type="button">Inside</button>
        </ModalDialog>
      </StrictMode>,
    );
    expect(screen.getByRole('dialog', { name: 'Demo dialog' })).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument();
  });

  it('leaves Escape keydown to the native cancel event when showModal() exists', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    await openDialog(user);
    await user.keyboard('{Escape}');
    expect(spy).not.toHaveBeenCalled();
  });
});
