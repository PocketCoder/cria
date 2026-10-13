import './mocks';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from '@/components/ui/segmented-control';

const OPTIONS = [
  { value: 'a', label: 'List' },
  { value: 'b', label: 'Board' },
  { value: 'c', label: 'Gantt' },
] as const;

function Harness({ initial = 'a', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      aria-label="View"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('SegmentedControl keyboard', () => {
  it('uses a roving tabindex on the selected tab', () => {
    render(<Harness initial="b" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('keeps the first tab tabbable when nothing is selected', () => {
    render(<SegmentedControl options={OPTIONS} value={undefined} onChange={() => undefined} />);
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves focus and selection with arrows, wrapping at the ends', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();

    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['b', 'a', 'c']);

    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();
  });

  it('jumps with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    screen.getAllByRole('tab')[1]!.focus();
    await user.keyboard('{End}');
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getAllByRole('tab')[0]).toHaveFocus();
  });
});

describe('SegmentedControl indicator', () => {
  let resize: (() => void)[] = [];
  const descriptors: Record<string, PropertyDescriptor | undefined> = {};

  beforeEach(() => {
    resize = [];
    // jsdom has no layout: size a segment by its label, and (like a browser)
    // report 0 for detached nodes.
    const sizes: Record<string, (el: HTMLElement) => number> = {
      offsetWidth: (el) => el.textContent!.length * 10,
      offsetHeight: () => 20,
      offsetLeft: () => 0,
      offsetTop: () => 0,
    };
    for (const [prop, fn] of Object.entries(sizes)) {
      descriptors[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          return this.hasAttribute('data-seg') && this.isConnected ? fn(this) : 0;
        },
      });
    }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resize.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    for (const [prop, d] of Object.entries(descriptors)) {
      if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
    vi.unstubAllGlobals();
  });

  const indicator = (c: HTMLElement) => c.querySelector<HTMLElement>('[aria-hidden="true"]')!;
  const noop = () => undefined;

  it('re-measures when labels change at the same count and index', () => {
    const { container, rerender } = render(
      <SegmentedControl options={[{ value: 'x', label: 'One' }, { value: 'y', label: 'Two' }]} value="x" onChange={noop} />,
    );
    expect(indicator(container).style.width).toBe('30px');
    rerender(
      <SegmentedControl options={[{ value: 'x', label: 'Longer label' }, { value: 'y', label: 'Two' }]} value="x" onChange={noop} />,
    );
    expect(indicator(container).style.width).toBe('120px');
  });

  it('measures the current button after options are replaced, not a detached one', () => {
    const { container, rerender } = render(
      <SegmentedControl options={[{ value: 'x', label: 'One' }, { value: 'y', label: 'Two' }]} value="x" onChange={noop} />,
    );
    rerender(
      <SegmentedControl options={[{ value: 'p', label: 'Alpha' }, { value: 'q', label: 'Beta' }]} value="p" onChange={noop} />,
    );
    act(() => resize.forEach((cb) => cb()));
    expect(indicator(container).style.width).toBe('50px');
  });
});
