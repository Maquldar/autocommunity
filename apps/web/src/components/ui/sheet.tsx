'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './icon-button';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva(
  'fixed z-sheet flex flex-col bg-popover text-popover-foreground shadow-xl focus:outline-none',
  {
    variants: {
      side: {
        // Bottom sheet on phones, right-hand panel from lg (1024px) up.
        auto: [
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t pb-safe',
          'data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down',
          'lg:inset-y-0 lg:end-0 lg:start-auto lg:max-h-none lg:w-[26rem] lg:rounded-none lg:rounded-s-2xl lg:border-s lg:border-t-0 lg:pb-0',
          'lg:data-[state=open]:animate-sheet-left lg:data-[state=closed]:animate-sheet-right',
        ],
        bottom:
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t pb-safe data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down',
        right:
          'inset-y-0 end-0 w-full max-w-[26rem] border-s data-[state=open]:animate-sheet-left data-[state=closed]:animate-sheet-right sm:rounded-s-2xl',
      },
    },
    defaultVariants: { side: 'auto' },
  },
);

export type SheetContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: 'auto' | 'bottom' | 'right';
  hideClose?: boolean;
};

export const SheetContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  function SheetContent({ className, children, side = 'auto', hideClose = false, ...props }, ref) {
    const t = useTranslations('common');
    const showHandle = side !== 'right';
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-sheet bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
          {showHandle ? (
            <div aria-hidden="true" className={cn('flex justify-center pt-2.5', side === 'auto' && 'lg:hidden')}>
              <span className="h-1 w-10 rounded-full bg-border" />
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pb-5 pt-3 lg:pt-6">
            {children}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <IconButton
                aria-label={t('close')}
                size="sm"
                className="absolute end-3 top-4 text-muted-foreground"
              >
                <X />
              </IconButton>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 pe-10', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-auto flex flex-col gap-2 pt-2', className)} {...props} />;
}

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
});

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});
