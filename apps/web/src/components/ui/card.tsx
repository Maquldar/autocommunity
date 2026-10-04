import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const cardVariants = cva('rounded-2xl bg-card text-card-foreground', {
  variants: {
    variant: {
      default: 'border shadow-sm',
      flat: 'border',
      elevated: 'shadow-md',
      // Clickable card: wrap content in a link/button and pass this variant.
      interactive:
        'border shadow-sm transition-[box-shadow,border-color,transform] duration-fast ease-standard hover:border-input hover:shadow-md active:scale-[0.995]',
    },
    padding: { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-6' },
  },
  defaultVariants: { variant: 'default', padding: 'md' },
});

export type CardProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>;

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold leading-6 tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex flex-wrap items-center gap-2', className)} {...props} />;
}
