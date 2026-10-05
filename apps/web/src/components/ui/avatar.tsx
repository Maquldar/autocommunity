'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { getAvatarColorIndex, getInitials } from '@/lib/avatar';
import { cn } from '@/lib/cn';

// Static class list so Tailwind can see every colour utility.
const colorClasses = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
] as const;

const avatarVariants = cva('relative inline-flex shrink-0 select-none overflow-hidden bg-muted', {
  variants: {
    size: {
      xs: 'size-6 text-[0.625rem]',
      sm: 'size-8 text-xs',
      md: 'size-10 text-sm',
      lg: 'size-14 text-lg',
      xl: 'size-24 text-3xl',
    },
    shape: { circle: 'rounded-full', square: 'rounded-xl' },
  },
  // Square (community) avatars keep a ~25% corner radius at every size, so small ones don't read as circles.
  compoundVariants: [
    { shape: 'square', size: 'xs', className: 'rounded-[6px]' },
    { shape: 'square', size: 'sm', className: 'rounded-[8px]' },
    { shape: 'square', size: 'md', className: 'rounded-[10px]' },
    { shape: 'square', size: 'lg', className: 'rounded-[14px]' },
    { shape: 'square', size: 'xl', className: 'rounded-2xl' },
  ],
  defaultVariants: { size: 'md', shape: 'circle' },
});

export type AvatarProps = Omit<ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, 'children'> &
  VariantProps<typeof avatarVariants> & {
    /** Stable id (user or community). Drives the fallback colour. */
    id: string;
    name: string;
    src?: string | null;
    /** Decorative avatars next to a visible name should pass `decorative` to avoid double announcements. */
    decorative?: boolean;
  };

export const Avatar = forwardRef<ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(function Avatar(
  { id, name, src, size, shape, decorative = false, className, ...props },
  ref,
) {
  const colorClass = colorClasses[getAvatarColorIndex(id) - 1];
  return (
    <AvatarPrimitive.Root
      ref={ref}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(avatarVariants({ size, shape }), className)}
      {...props}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        // No delay without an image (renders on first paint); with one, wait briefly to avoid a flash.
        delayMs={src ? 400 : undefined}
        data-testid="avatar-fallback"
        className={cn('flex size-full items-center justify-center font-semibold text-white', colorClass)}
      >
        {getInitials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});
