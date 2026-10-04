'use client';

import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { cn } from '@/lib/cn';

export function OfflineBanner({ className, forceVisible = false }: { className?: string; forceVisible?: boolean }) {
  const t = useTranslations('states');
  const online = useOnlineStatus();
  const visible = forceVisible || !online;
  return (
    // The live region is always mounted so screen readers announce the change.
    <div role="status" aria-live="polite" className={className}>
      {visible ? (
        <div
          className={cn(
            'flex items-center justify-center gap-2 bg-foreground px-4 py-2 text-center text-sm font-medium text-background',
          )}
        >
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          <span>{t('offline')}</span>
        </div>
      ) : null}
    </div>
  );
}
