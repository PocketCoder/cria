import './mocks';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCheck } from '@/components/ui/task-check';

describe('TaskCheck', () => {
  it('is named after the task, with the state in aria-checked', () => {
    render(
      <>
        <TaskCheck checked={false} title="Buy milk" onToggle={() => {}} />
        <TaskCheck checked title="Post letter" onToggle={() => {}} />
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'Buy milk', checked: false })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Post letter', checked: true })).toBeTruthy();
  });

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TaskCheck checked={false} title="Buy milk" onToggle={onToggle} />);
    await user.click(screen.getByRole('checkbox', { name: 'Buy milk' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
