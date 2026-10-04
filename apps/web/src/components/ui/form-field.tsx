'use client';

import { Slot } from '@radix-ui/react-slot';
import { CircleAlert } from 'lucide-react';
import { useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Label } from './label';

export type FormFieldProps = {
  label: ReactNode;
  /** The control. It receives id, aria-describedby, aria-invalid and aria-required. */
  children: ReactElement;
  hint?: ReactNode;
  /** Validation message. When set the control is marked aria-invalid and the hint is replaced. */
  error?: ReactNode;
  required?: boolean;
  /** Override the generated control id (e.g. to match an external <label>). */
  id?: string;
  className?: string;
  /** Extra content on the label row, e.g. a "Forgot?" link. */
  labelAside?: ReactNode;
};

/**
 * Label + control + hint + error with all ARIA wiring done.
 * The label is always visible (never placeholder-only, see DESIGN.md §Forms).
 */
export function FormField({ label, children, hint, error, required, id, className, labelAside }: FormFieldProps) {
  const generatedId = useId();
  const controlId = id ?? `field-${generatedId}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const hasError = Boolean(error);
  const describedBy = [hasError ? errorId : null, hint && !hasError ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={controlId} required={required}>
          {label}
        </Label>
        {labelAside}
      </div>
      <Slot
        id={controlId}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError || undefined}
        aria-required={required || undefined}
      >
        {children}
      </Slot>
      {hasError ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
