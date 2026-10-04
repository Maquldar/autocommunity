'use client';

import { useTheme } from 'next-themes';
import type { CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';

/** Mounted once in the root providers. Use `notify` from '@/lib/toast' to show toasts. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="top-center"
      closeButton
      visibleToasts={3}
      offset="calc(var(--safe-top) + 0.75rem)"
      mobileOffset={{ top: 'calc(var(--safe-top) + 0.75rem)', left: '1rem', right: '1rem' }}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-lg !font-sans !text-[0.9375rem]',
          description: '!text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground !rounded-md !font-medium',
          cancelButton: '!bg-secondary !text-secondary-foreground !rounded-md',
          closeButton: '!bg-popover !border-border !text-muted-foreground',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-danger',
          warning: '[&_[data-icon]]:!text-warning',
          info: '[&_[data-icon]]:!text-primary',
        },
      }}
      style={{ zIndex: 'var(--z-toast)' } as CSSProperties}
    />
  );
}
