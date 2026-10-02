import './mocks';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrioritySelect } from '@/components/ui/priority-select';

function Harness({
  initial = 0,
  variant,
  onChange,
}: {
  initial?: number;
  variant?: 'segmented' | 'pill';
  onChange?: (v: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <PrioritySelect
      variant={variant}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const checked = () => screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'));
const tabIndexes = () => screen.getAllByRole('radio').map((r) => r.tabIndex);

describe.each(['segmented', 'pill'] as const)('PrioritySelect keyboard (%s)', (variant) => {
  // The pill keeps its options in a popover; open it first.
  const setup = async (initial: number, onChange?: (v: number) => void) => {
    const user = userEvent.setup();
    render(<Harness initial={initial} variant={variant} onChange={onChange} />);
    if (variant === 'pill') await user.click(screen.getByRole('button', { name: /^Priority/ }));
    return user;
  };

  it('uses a roving tabindex on the checked option', async () => {
    await setup(3);
    expect(tabIndexes()).toEqual([-1, -1, -1, 0, -1, -1]);
    expect(checked()).toEqual(['false', 'false', 'false', 'true', 'false', 'false']);
  });

  it('moves focus and selection with arrows, wrapping at the ends', async () => {
    const onChange = vi.fn();
    const user = await setup(0, onChange);
    const radios = screen.getAllByRole('radio');
    radios[0]!.focus();

    await user.keyboard('{ArrowRight}');
    expect(radios[1]).toHaveFocus();
    expect(checked()[1]).toBe('true');
    expect(tabIndexes()).toEqual([-1, 0, -1, -1, -1, -1]);

    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(radios[5]).toHaveFocus();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([1, 0, 5]);

    await user.keyboard('{ArrowDown}');
    expect(radios[0]).toHaveFocus();
    expect(checked()[0]).toBe('true');
  });

  it('jumps with Home and End', async () => {
    const user = await setup(2);
    screen.getAllByRole('radio')[2]!.focus();
    await user.keyboard('{End}');
    expect(screen.getAllByRole('radio')[5]).toHaveFocus();
    expect(checked()[5]).toBe('true');
    await user.keyboard('{Home}');
    expect(screen.getAllByRole('radio')[0]).toHaveFocus();
    expect(checked()[0]).toBe('true');
  });
});
