'use client';

import { Siren, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { sosAlertStore } from './alerts';
import { useDistance } from './parts';
import { SOS_TYPE_ICONS } from './sos-type';

const EMPTY: never[] = [];

/**
 * Urgent "someone nearby needs help" banner (from `sos:new` / `sos_nearby`), pinned under the top bar
 * on every signed-in page until the driver views or dismisses it. Calm layout, SOS colours, one action.
 */
export function SosAlertHost() {
  const t = useTranslations('sos');
  const pathname = usePathname();
  const alerts = useSyncExternalStore(sosAlertStore.subscribe, sosAlertStore.get, () => EMPTY);
  const distance = useDistance();
  const alert = alerts[0];

  // Already looking at it: the page itself is the alert.
  useEffect(() => {
    if (alert && pathname === `/sos/${alert.sosId}`) sosAlertStore.dismiss(alert.sosId);
  }, [alert, pathname]);

  if (!alert || pathname === `/sos/${alert.sosId}`) return null;
  const Icon = SOS_TYPE_ICONS[alert.type];
  const more = alerts.length - 1;

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-toast flex justify-center px-3 lg:ps-[calc(var(--sidebar-width)+0.75rem)]',
        // On the map, sit below the map's own top controls (visibility, SOS layer, filters) so they stay usable.
        pathname === '/map' ? 'top-[calc(var(--safe-top)+var(--header-height)+4.25rem)]' : 'top-[calc(var(--safe-top)+var(--header-height)+0.5rem)]',
      )}
    >
      <div
        role="alert"
        aria-live="assertive"
        data-testid="sos-alert"
        data-sos-id={alert.sosId}
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-sos bg-card p-3 shadow-lg animate-pop-in"
      >
        <span aria-hidden="true" className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-sos text-sos-foreground motion-safe:animate-sos-pulse">
          <Icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sos-soft-foreground">
            <Siren aria-hidden="true" className="size-3.5" />
            {t('alert.title')}
          </p>
          <p className="font-semibold leading-snug break-words">
            {t(`types.${alert.type}`)}
            {alert.distanceM !== null ? <span className="font-normal text-muted-foreground"> · {distance(alert.distanceM)}</span> : null}
          </p>
          {alert.requesterName ? <p className="text-sm text-muted-foreground break-words">{t('alert.who', { name: alert.requesterName })}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button asChild size="sm" onClick={() => sosAlertStore.dismiss(alert.sosId)}>
              <Link href={`/sos/${alert.sosId}`}>{t('alert.view')}</Link>
            </Button>
            {more > 0 ? <span className="text-sm text-muted-foreground">{t('alert.more', { count: more })}</span> : null}
          </div>
        </div>
        <IconButton aria-label={t('alert.dismiss')} size="sm" variant="ghost" className="-me-1 -mt-1 shrink-0" onClick={() => sosAlertStore.dismiss(alert.sosId)}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}
