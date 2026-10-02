import './mocks';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldLabel } from '@/components/ui/field-label';

describe('FieldLabel', () => {
  it('names the wrapped control with visible text, independent of the placeholder', () => {
    render(
      <FieldLabel label="Current password">
        <input type="password" placeholder="••••••" />
      </FieldLabel>,
    );
    const input = screen.getByLabelText('Current password');
    expect(input).toHaveAttribute('placeholder', '••••••');
    expect(screen.getByText('Current password')).toBeVisible();
  });
});
