import './mocks';
import { createRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFocusOnMount } from '@/lib/useFocusOnMount';

function Field({ shared }: { shared?: React.RefObject<HTMLInputElement | null> }) {
  const [n, setN] = useState(0);
  const focus = useFocusOnMount<HTMLInputElement>(shared);
  return (
    <>
      <input aria-label="field" ref={focus} />
      <button type="button" onClick={() => setN(n + 1)}>
        rerender {n}
      </button>
    </>
  );
}

describe('useFocusOnMount', () => {
  it('focuses on mount and does not steal focus back on re-render', async () => {
    const user = userEvent.setup();
    render(<Field />);
    expect(screen.getByLabelText('field')).toHaveFocus();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('keeps a shared ref object in sync', () => {
    const shared = createRef<HTMLInputElement>();
    const { unmount } = render(<Field shared={shared} />);
    expect(shared.current).toBe(screen.getByLabelText('field'));
    unmount();
    expect(shared.current).toBeNull();
  });
});
