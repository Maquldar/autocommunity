'use client';

import { useTranslations } from 'next-intl';
import {
  useRef,
  type AriaAttributes,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/cn';
import { controlClasses } from './input';

export type OtpInputProps = {
  /** Contiguous digits entered so far ("", "12", "123456"). */
  value: string;
  onChange: (value: string) => void;
  /** Fires once when all boxes are filled. */
  onComplete?: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Applied to the first box so an external <label htmlFor> focuses it. */
  id?: string;
  /** Name of a hidden input carrying the full code for native form submission. */
  name?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  'aria-required'?: AriaAttributes['aria-required'];
};

const onlyDigits = (input: string) => input.replace(/\D/g, '');

/**
 * One-time-code entry: N single-digit boxes with auto-advance, smart backspace,
 * full-code paste (into any box) and SMS autofill via autocomplete="one-time-code".
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  autoFocus,
  id,
  name,
  className,
  ...aria
}: OtpInputProps) {
  const t = useTranslations('otp');
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const code = onlyDigits(value).slice(0, length);
  // Latest committed code. Focus moves synchronously after a change, before the parent re-renders,
  // so handlers that run during that focus must not read the stale `code` from this render.
  const latest = useRef(code);
  latest.current = code;

  function focusBox(index: number) {
    const target = refs.current[Math.max(0, Math.min(index, length - 1))];
    target?.focus();
    target?.select();
  }

  function commit(next: string) {
    const clean = onlyDigits(next).slice(0, length);
    if (clean === latest.current) return;
    latest.current = clean;
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  }

  /** Write `digits` starting at box `start`, then move focus to the next empty box. */
  function fill(start: number, digits: string) {
    const next = (code.slice(0, start) + digits).slice(0, length);
    commit(next);
    focusBox(next.length);
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const digits = onlyDigits(event.target.value);
    if (!digits) {
      commit(code.slice(0, index) + code.slice(index + 1));
      return;
    }
    // More than one digit: SMS autofill or a fast typist over an unselected box.
    if (digits.length > 1) {
      const previous = code[index];
      const typed = previous && digits.length === 2 ? digits.replace(previous, '') : digits;
      fill(digits.length >= length ? 0 : index, typed.length === 1 ? typed : digits);
      return;
    }
    fill(index, digits);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        if (code[index] !== undefined) {
          commit(code.slice(0, index) + code.slice(index + 1));
          focusBox(index);
        } else if (index > 0) {
          commit(code.slice(0, index - 1) + code.slice(index));
          focusBox(index - 1);
        }
        break;
      }
      case 'Delete': {
        event.preventDefault();
        commit(code.slice(0, index) + code.slice(index + 1));
        break;
      }
      case 'ArrowLeft':
        event.preventDefault();
        focusBox(index - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusBox(Math.min(index + 1, code.length));
        break;
      default:
        break;
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const digits = onlyDigits(event.clipboardData.getData('text'));
    event.preventDefault();
    if (!digits) return;
    fill(digits.length >= length ? 0 : index, digits);
  }

  function handleFocus(index: number) {
    // Boxes fill left to right; tapping a later empty box jumps to the first empty one.
    const filled = latest.current.length;
    if (index > filled) focusBox(filled);
    else refs.current[index]?.select();
  }

  return (
    <div role="group" aria-label={t('label')} className={cn('grid w-full max-w-sm gap-2', className)} style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          id={index === 0 ? id : undefined}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          value={code[index] ?? ''}
          aria-label={t('digit', { index: index + 1, total: length })}
          {...aria}
          onChange={(event) => handleChange(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={() => handleFocus(index)}
          className={cn(
            controlClasses,
            'h-14 min-w-0 px-0 text-center text-2xl font-semibold tabular-nums caret-primary',
            code[index] !== undefined && 'border-foreground/50',
          )}
        />
      ))}
      {name ? <input type="hidden" name={name} value={code} /> : null}
    </div>
  );
}
