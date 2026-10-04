'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const RadioGroup = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...props} />;
});

/** Classic radio dot. Pair with a <Label htmlFor>. */
export const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'peer relative aspect-square size-5 shrink-0 rounded-full border-2 border-input bg-card',
        'transition-colors duration-fast focus-ring data-[state=checked]:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        "after:absolute after:-inset-3 after:content-['']",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span className="size-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});

type RadioCardProps = Omit<ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, 'children' | 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Optional trailing content, e.g. a "Recommended" badge. */
  aside?: ReactNode;
};

/**
 * Large selectable card (e.g. choosing a privacy mode). The whole card is the radio;
 * the selected state is shown by border, tint AND a check dot (never colour alone).
 */
export const RadioCard = forwardRef<ElementRef<typeof RadioGroupPrimitive.Item>, RadioCardProps>(function RadioCard(
  { className, title, description, icon: Icon, aside, ...props },
  ref,
) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-start',
        'transition-[border-color,background-color,box-shadow] duration-fast ease-standard focus-ring',
        'hover:border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft data-[state=checked]:shadow-[inset_0_0_0_1px_var(--primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {Icon ? (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {title}
          {aside}
        </span>
        {description ? (
          <span className="text-sm text-muted-foreground group-data-[state=checked]:text-foreground/80">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-input bg-card group-data-[state=checked]:border-primary"
      >
        <span className="size-2.5 scale-0 rounded-full bg-primary transition-transform duration-fast group-data-[state=checked]:scale-100" />
      </span>
    </RadioGroupPrimitive.Item>
  );
});
