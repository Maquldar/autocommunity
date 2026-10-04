import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formatKzPhone, isCompleteKzPhone, parsePhoneInput, toE164 } from '@/lib/phone-mask';
import { renderWithIntl } from '../../../test/render';
import { PhoneInput } from './phone-input';

describe('phone mask helpers', () => {
  it('formats progressively as "+7 (7XX) XXX-XX-XX"', () => {
    expect(formatKzPhone('')).toBe('');
    expect(formatKzPhone('7')).toBe('+7 (7');
    expect(formatKzPhone('701')).toBe('+7 (701');
    expect(formatKzPhone('7011')).toBe('+7 (701) 1');
    expect(formatKzPhone('7011234')).toBe('+7 (701) 123-4');
    expect(formatKzPhone('701123456')).toBe('+7 (701) 123-45-6');
    expect(formatKzPhone('7011234567')).toBe('+7 (701) 123-45-67');
  });

  it.each([
    ['7011234567', '7011234567'],
    ['+7 701 123 45 67', '7011234567'],
    ['+7 (701) 123-45-67', '7011234567'],
    ['8 701 123 45 67', '7011234567'],
    ['87011234567', '7011234567'],
    ['77011234567', '7011234567'],
    ['+77011234567', '7011234567'],
    // An extra keystroke at the end of a full masked number is ignored.
    ['+7 (701) 123-45-679', '7011234567'],
  ])('parses %j → %s', (raw, national) => {
    expect(parsePhoneInput(raw)).toBe(national);
  });

  it('builds and validates E.164', () => {
    expect(toE164('')).toBe('');
    expect(toE164('7011234567')).toBe('+77011234567');
    expect(isCompleteKzPhone('+77011234567')).toBe(true);
    expect(isCompleteKzPhone('+7701123456')).toBe(false);
    expect(isCompleteKzPhone('+79011234567')).toBe(false);
  });
});

function Controlled({ onChange, onComplete }: { onChange: (v: string) => void; onComplete: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <PhoneInput
      aria-label="Phone"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      onComplete={onComplete}
    />
  );
}

describe('<PhoneInput>', () => {
  it('masks typed digits one by one and emits E.164', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    renderWithIntl(<Controlled onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByLabelText<HTMLInputElement>('Phone');

    for (const digit of '7011234567') {
      fireEvent.change(input, { target: { value: input.value + digit } });
    }

    expect(input.value).toBe('+7 (701) 123-45-67');
    expect(onChange).toHaveBeenLastCalledWith('+77011234567');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('+77011234567');
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('autocomplete', 'tel');
  });

  it('replaces the field with a pasted domestic number', () => {
    const onChange = vi.fn();
    renderWithIntl(<Controlled onChange={onChange} onComplete={vi.fn()} />);
    const input = screen.getByLabelText<HTMLInputElement>('Phone');
    fireEvent.change(input, { target: { value: '70' } });

    fireEvent.paste(input, { clipboardData: { getData: () => '8 (701) 123-45-67' } });

    expect(input.value).toBe('+7 (701) 123-45-67');
    expect(onChange).toHaveBeenLastCalledWith('+77011234567');
  });

  it('emits an empty string when cleared', () => {
    const onChange = vi.fn();
    renderWithIntl(<Controlled onChange={onChange} onComplete={vi.fn()} />);
    const input = screen.getByLabelText<HTMLInputElement>('Phone');
    fireEvent.change(input, { target: { value: '7' } });
    expect(input.value).toBe('+7 (7');
    fireEvent.change(input, { target: { value: '+7 (' } });
    expect(input.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
