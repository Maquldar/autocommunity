'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  /** Shows a visual asterisk. Pair with `required`/`aria-required` on the control for screen readers. */
  required?: boolean;
};

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, LabelProps>(function Label(
  { className, required, children, ...props },
  ref,
) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-sm font-medium leading-5 text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="ms-0.5 text-danger">
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
});
