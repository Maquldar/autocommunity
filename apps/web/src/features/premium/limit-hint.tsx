'use client';

import { Crown } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { premiumLimitInfo } from './limit';

/** "With premium you can have up to N" + a link to /premium, under a limit error (nothing otherwise). */
export function PremiumLimitHint({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations('premium.limitHint');
  const info = premiumLimitInfo(error);
  if (!info) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-premium-soft px-3 py-2 text-sm text-premium-soft-foreground', className)} data-testid="premium-limit-hint">
      <Crown aria-hidden="true" className="size-4 shrink-0" />
      <span>{t(info.code, { limit: info.limit, premiumLimit: info.premiumLimit })}</span>
      <Link href="/premium" className="rounded-sm font-semibold underline underline-offset-4 focus-ring">
        {t('link')}
      </Link>
    </p>
  );
}

/** Toast action for limit errors raised where there is no inline place (join buttons). */
export function premiumToastAction(error: unknown, label: string, go: (href: string) => void) {
  return premiumLimitInfo(error) ? { label, onClick: () => go('/premium') } : undefined;
}
