import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../test/render';
import { OtpInput } from './otp-input';

function Controlled({ initial = '', onComplete }: { initial?: string; onComplete?: (code: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const value = () => screen.getByTestId('value').textContent;

describe('<OtpInput>', () => {
  it('renders 6 numeric boxes with one-time-code autofill on the first', () => {
    renderWithIntl(<Controlled />);
    const inputs = boxes();
    expect(inputs).toHaveLength(6);
    expect(inputs[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(inputs[0]).toHaveAttribute('inputmode', 'numeric');
    expect(inputs[3]).toHaveAccessibleName('Digit 4 of 6');
    expect(screen.getByRole('group', { name: 'Verification code' })).toBeInTheDocument();
  });

  it('auto-advances focus while typing and ignores non-digits', () => {
    renderWithIntl(<Controlled />);
    fireEvent.change(boxes()[0]!, { target: { value: '4' } });
    expect(boxes()[1]).toHaveFocus();
    fireEvent.change(boxes()[1]!, { target: { value: 'a' } });
    expect(value()).toBe('4');
    fireEvent.change(boxes()[1]!, { target: { value: '2' } });
    expect(value()).toBe('42');
    expect(boxes()[2]).toHaveFocus();
  });

  it('fills every box when a full code is pasted into any box', () => {
    const onComplete = vi.fn();
    renderWithIntl(<Controlled onComplete={onComplete} />);
    fireEvent.paste(boxes()[3]!, { clipboardData: { getData: () => 'Your code: 123-456' } });
    expect(value()).toBe('123456');
    expect(boxes().map((b) => b.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(boxes()[5]).toHaveFocus();
  });

  it('handles SMS autofill of the whole code into the first box', () => {
    const onComplete = vi.fn();
    renderWithIntl(<Controlled onComplete={onComplete} />);
    fireEvent.change(boxes()[0]!, { target: { value: '987654' } });
    expect(value()).toBe('987654');
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('backspace clears the current digit, then moves back and clears the previous one', () => {
    renderWithIntl(<Controlled initial="1234" />);
    // Box 4 (index 3) holds "4": first backspace clears it and keeps focus there.
    boxes()[3]!.focus();
    fireEvent.keyDown(boxes()[3]!, { key: 'Backspace' });
    expect(value()).toBe('123');
    expect(boxes()[3]).toHaveFocus();
    // Now box 4 is empty: backspace moves to box 3 and clears it.
    fireEvent.keyDown(boxes()[3]!, { key: 'Backspace' });
    expect(value()).toBe('12');
    expect(boxes()[2]).toHaveFocus();
  });

  it('focusing a later empty box jumps to the first empty one', () => {
    renderWithIntl(<Controlled initial="12" />);
    boxes()[5]!.focus();
    expect(boxes()[2]).toHaveFocus();
  });
});
