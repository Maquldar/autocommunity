'use client';

import { useTranslations } from 'next-intl';
import { forwardRef, useId, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { controlClasses } from './input';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Shows "n / maxLength" under the field. Requires `maxLength`. */
  showCount?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, showCount = false, maxLength, value, defaultValue, onChange, rows = 4, ...props },
  ref,
) {
  const t = useTranslations('form');
  const counterId = useId();
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? '').length);
  const length = value !== undefined ? String(value).length : uncontrolledLength;
  const withCounter = showCount && maxLength !== undefined;

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (value === undefined) setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  }

  const describedBy = [props['aria-describedby'], withCounter ? counterId : null].filter(Boolean).join(' ');

  const field = (
    <textarea
      ref={ref}
      rows={rows}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      className={cn(controlClasses, 'min-h-24 resize-y px-3.5 py-2.5 leading-6', className)}
      {...props}
      aria-describedby={describedBy || undefined}
    />
  );

  if (!withCounter) return field;

  const nearLimit = length >= maxLength * 0.9;
  return (
    <div className="flex w-full flex-col gap-1">
      {field}
      <p
        id={counterId}
        className={cn(
          'self-end text-xs tabular-nums text-muted-foreground',
          nearLimit && 'font-medium text-warning',
        )}
      >
        <span aria-hidden="true">
          {length} / {maxLength}
        </span>
        <span className="sr-only">{t('charCount', { count: length, max: maxLength })}</span>
      </p>
    </div>
  );
});
