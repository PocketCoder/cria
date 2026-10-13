import './mocks';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabeledInput } from '@/components/ui/labeled-input';

describe('LabeledInput', () => {
  it('names the input with visible text, independent of the placeholder', () => {
    render(<LabeledInput label="Current password" type="password" placeholder="••••••" inputClassName="x" />);
    const input = screen.getByLabelText('Current password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('placeholder', '••••••');
    expect(input).toHaveClass('x');
    expect(screen.getByText('Current password')).toBeVisible();
  });

  it('passes standard input props through', () => {
    render(<LabeledInput label="Code" maxLength={6} disabled defaultValue="12" />);
    const input = screen.getByLabelText('Code');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('maxlength', '6');
    expect(input).toHaveValue('12');
  });
});
