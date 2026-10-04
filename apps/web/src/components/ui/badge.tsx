import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const badgeVariants = cva(
  'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-foreground',
        primary: 'bg-primary-soft text-primary-soft-foreground',
        success: 'bg-success-soft text-success-soft-foreground',
        warning: 'bg-warning-soft text-warning-soft-foreground',
        danger: 'bg-danger-soft text-danger-soft-foreground',
        // SOS status only (active SOS, accident). Not for generic "new"/"hot" labels.
        sos: 'bg-sos text-sos-foreground',
        outline: 'border border-border text-foreground',
      },
      size: {
        sm: 'h-5 px-2 text-xs',
        md: 'h-6 px-2.5 text-[0.8125rem]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** Small numeric counter (unread messages, notifications). Caps at 99+. */
export function CountBadge({ count, className, ...props }: HTMLAttributes<HTMLSpanElement> & { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold tabular-nums leading-none text-primary-foreground ring-2 ring-background',
        className,
      )}
      {...props}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
