import './mocks';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecurrencePicker } from '@/components/ui/recurrence-picker';
import { renderWithProviders } from './render';

function Harness({ initial }: { initial: [number, number] }) {
  const [after, setAfter] = useState<number | null>(initial[0]);
  const [mode, setMode] = useState<number | null>(initial[1]);
  return (
    <>
      <RecurrencePicker
        repeatAfter={after}
        repeatMode={mode}
        onChange={(a, m) => {
          setAfter(a);
          setMode(m);
        }}
      />
      <output data-testid="value">{`${after}/${mode}`}</output>
    </>
  );
}

describe('RecurrencePicker mode switching', () => {
  it.each([
    ['From creation date', '2592000/0'],
    ['From completion date', '2592000/2'],
  ])('seeds one month when leaving monthly for %s', async (label, expected) => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={[0, 1]} />);

    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await user.click(await screen.findByRole('button', { name: label }));

    expect(screen.getByTestId('value')).toHaveTextContent(expected);
  });

  it('emits a zero interval for monthly', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={[604_800, 0]} />);

    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await user.click(await screen.findByRole('button', { name: 'Monthly (same day)' }));

    expect(screen.getByTestId('value')).toHaveTextContent(/^0\/1$/);
  });
});
