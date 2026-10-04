'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { SpinnerGlyph } from './spinner';

const iconButtonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center rounded-full',
    'transition-[background-color,color,transform] duration-fast ease-standard focus-ring active:scale-95',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        ghost: 'text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        outline: 'border border-input bg-card text-foreground hover:bg-accent',
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        danger: 'text-danger hover:bg-danger-soft',
        sos: 'bg-sos text-sos-foreground shadow-md hover:bg-sos-hover',
      },
      size: {
        sm: "size-9 [&_svg]:size-[1.125rem] after:absolute after:-inset-1 after:content-['']",
        md: 'size-11 [&_svg]:size-5',
        lg: 'size-12 [&_svg]:size-6',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required: icon-only buttons have no visible text. */
    'aria-label': string;
    asChild?: boolean;
    loading?: boolean;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, asChild = false, loading = false, disabled, type, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(iconButtonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? <SpinnerGlyph /> : children}
    </Comp>
  );
});
