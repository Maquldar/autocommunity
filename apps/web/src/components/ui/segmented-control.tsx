'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type SegmentedOption<V extends string> = {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  lang?: string;
};

export type SegmentedControlProps<V extends string> = {
  value: V;
  onValueChange: (value: V) => void;
  options: ReadonlyArray<SegmentedOption<V>>;
  /** Accessible name of the group. */
  label: string;
  className?: string;
  disabled?: boolean;
};

/** Small exclusive choice (2–4 options) shown inline. Radix radio group: arrow keys move, roving focus. */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
  disabled,
}: SegmentedControlProps<V>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onValueChange(match.value);
      }}
      aria-label={label}
      disabled={disabled}
      orientation="horizontal"
      className={cn('flex gap-1 rounded-xl bg-muted p-1', className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          lang={option.lang}
          className={cn(
            'inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium',
            'text-muted-foreground transition-[color,background-color,box-shadow] duration-fast focus-ring hover:text-foreground',
            'data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-sm',
            // In dark mode the card is darker than the track; lift the selected segment instead.
            'dark:data-[state=checked]:bg-secondary-hover',
            // Icons are decorative; drop them on narrow phones so labels never truncate.
            'disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 max-[26rem]:[&_svg]:hidden',
          )}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
