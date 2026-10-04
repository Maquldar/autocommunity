'use client';

import { forwardRef, type ChangeEvent, type ClipboardEvent, type InputHTMLAttributes } from 'react';
import {
  formatKzPhone,
  fromE164,
  isCompleteKzPhone,
  KZ_NATIONAL_LENGTH,
  parsePhoneInput,
  toE164,
} from '@/lib/phone-mask';
import { cn } from '@/lib/cn';
import { Input } from './input';

export type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  /** E.164 value, possibly partial while typing ("+7701"). Empty string when cleared. */
  value: string;
  onChange: (e164: string) => void;
  /** Fires with the full E.164 number once all 10 national digits are entered. */
  onComplete?: (e164: string) => void;
};

/** Kazakhstan phone field: masks as "+7 (7XX) XXX-XX-XX" and emits E.164 ("+77011234567"). */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, onComplete, onPaste, placeholder = '+7 (7__) ___-__-__', className, ...props },
  ref,
) {
  function emit(next: string) {
    // Unchanged (e.g. only a separator was deleted): React re-renders the formatted value.
    if (next === value) return;
    onChange(next);
    if (isCompleteKzPhone(next)) onComplete?.(next);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    emit(toE164(parsePhoneInput(event.target.value)));
  }

  // A pasted full number replaces the field instead of merging with what was typed.
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(event);
    const text = event.clipboardData.getData('text');
    if (text.replace(/\D/g, '').length >= KZ_NATIONAL_LENGTH) {
      event.preventDefault();
      emit(toE164(parsePhoneInput(text)));
    }
  }

  return (
    <Input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      value={formatKzPhone(fromE164(value))}
      onChange={handleChange}
      onPaste={handlePaste}
      {...props}
      className={cn('tabular-nums tracking-wide', className)}
    />
  );
});
