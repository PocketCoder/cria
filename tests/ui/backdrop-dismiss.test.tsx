import './mocks';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';

function Modal({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Demo" className="fixed inset-0">
      <BackdropDismiss onDismiss={onClose} />
      <div className="relative">
        <button type="button">Inside</button>
      </div>
    </div>
  );
}

describe('BackdropDismiss', () => {
  it('closes on a backdrop click but not a panel click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<Modal onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Inside' }));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = container.querySelector('button[aria-hidden="true"]') as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is skipped by keyboard focus and hidden from the accessibility tree', async () => {
    const user = userEvent.setup();
    render(<Modal onClose={() => undefined} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
