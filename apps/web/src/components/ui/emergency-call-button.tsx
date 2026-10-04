'use client';

import { Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export type EmergencyCallButtonProps = {
  /** `full`: banner-style block for SOS/accident screens. `compact`: pill for headers and cards. */
  variant?: 'full' | 'compact';
  className?: string;
};

/**
 * "Call 112" — a real tel: link (works from the lock-screen dialer, no JS needed).
 * Must appear on every SOS screen and prominently for the "accident" SOS type (SPEC F-24, A-6).
 */
export function EmergencyCallButton({ variant = 'full', className }: EmergencyCallButtonProps) {
  const t = useTranslations('emergency');

  if (variant === 'compact') {
    return (
      <a
        href="tel:112"
        className={cn(
          'inline-flex h-11 shrink-0 items-center gap-2 rounded-full border-2 border-sos bg-card px-4 text-[0.9375rem] font-semibold text-sos-soft-foreground',
          'transition-colors duration-fast hover:bg-sos-soft focus-ring',
          className,
        )}
      >
        <Phone aria-hidden="true" className="size-4" strokeWidth={2.5} />
        {t('call112')}
      </a>
    );
  }

  return (
    <a
      href="tel:112"
      className={cn(
        'flex min-h-16 w-full items-center gap-4 rounded-2xl bg-sos px-5 py-3 text-sos-foreground shadow-md',
        'transition-[background-color,transform] duration-fast hover:bg-sos-hover active:scale-[0.99] focus-ring',
        className,
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Phone aria-hidden="true" className="size-5" strokeWidth={2.5} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-lg font-bold leading-6 tracking-wide">{t('call112')}</span>
        <span className="text-sm text-sos-foreground">{t('call112Hint')}</span>
      </span>
    </a>
  );
}
