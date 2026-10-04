'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SpinnerGlyph } from './spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium select-none',
    'transition-[background-color,color,box-shadow,transform,opacity] duration-fast ease-standard',
    'focus-ring active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    'aria-busy:cursor-progress aria-busy:opacity-90',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        outline: 'border border-input bg-card text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        danger: 'bg-danger text-danger-foreground shadow-sm hover:bg-danger-hover',
        // Reserved for SOS / emergency actions only (see DESIGN.md §SOS).
        sos: 'bg-sos text-sos-foreground font-semibold tracking-wide shadow-md hover:bg-sos-hover',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        // sm is 36px tall; the ::after extends the hit area to 44px for touch.
        // min-h (not h) so full-width buttons can wrap long translations instead of overflowing.
        sm: "min-h-9 px-3 py-1.5 text-sm [&_svg]:size-4 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        md: 'min-h-11 px-4 py-2 text-[0.9375rem] [&_svg]:size-[1.125rem]',
        lg: 'min-h-12 px-5 py-2.5 text-base [&_svg]:size-5',
        xl: 'min-h-14 rounded-xl px-6 py-3 text-lg [&_svg]:size-6',
      },
      fullWidth: { true: 'w-full whitespace-normal text-center leading-tight' },
    },
    compoundVariants: [{ variant: 'link', className: 'min-h-0 px-0 py-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element (e.g. a Link) with button styles. */
    asChild?: boolean;
    /** Shows a spinner, disables the button and sets aria-busy. Keeps the label to avoid layout shift. */
    loading?: boolean;
    /** Icon rendered before the label; replaced by the spinner while loading. */
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    asChild = false,
    loading = false,
    disabled,
    leadingIcon,
    trailingIcon,
    type,
    children,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      // Default to type="button" so buttons inside forms never submit by accident.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {loading ? <SpinnerGlyph /> : leadingIcon}
      <Slottable>{children}</Slottable>
      {trailingIcon}
    </Comp>
  );
});
