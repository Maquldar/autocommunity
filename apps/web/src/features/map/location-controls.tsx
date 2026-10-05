'use client';

import { LocateFixed, MapPinOff, Navigation, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/hooks/use-error-message';
import { cn } from '@/lib/cn';
import { useLocationSharing } from '@/lib/location/location-provider';
import { notify } from '@/lib/toast';

const CARD = 'pointer-events-auto rounded-2xl border bg-card p-4 shadow-lg';

/**
 * Location sharing UI over the map's lower edge:
 * - first visit: an explanation card with "Share my location" (the only thing that starts geolocation);
 * - after "Not now": a compact "Share my location" chip;
 * - sharing: a chip that says positions are only sent while the app is open, with "Stop sharing";
 * - blocked / unavailable / unsupported: an explanation of how to fix it. The map keeps working.
 */
export function LocationControls({ className }: { className?: string }) {
  const t = useTranslations('location');
  const errorMessage = useErrorMessage();
  const { status, consented, dismissed, enable, disable, dismiss } = useLocationSharing();
  const [problemClosed, setProblemClosed] = useState(false);
  const [stopping, setStopping] = useState(false);

  if (status === 'denied' || status === 'unavailable' || status === 'unsupported') {
    if (problemClosed) return null;
    const title = status === 'denied' ? t('deniedTitle') : status === 'unavailable' ? t('unavailableTitle') : t('unsupported');
    const body = status === 'denied' ? t('deniedBody') : status === 'unavailable' ? t('unavailableBody') : null;
    return (
      <div role="status" data-testid="location-problem" className={cn(CARD, 'flex gap-3', className)}>
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning-soft-foreground">
          <MapPinOff className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="pe-8 font-semibold">{title}</p>
          {body ? <p className="text-sm text-muted-foreground">{body}</p> : null}
          {status !== 'unsupported' ? (
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={enable}>
                {t('retry')}
              </Button>
            </div>
          ) : null}
        </div>
        <IconButton aria-label={t('dismiss')} size="sm" className="-me-2 -mt-2 shrink-0 text-muted-foreground" onClick={() => setProblemClosed(true)}>
          <X />
        </IconButton>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div role="status" className={cn(CARD, 'flex w-fit items-center gap-2 px-3 py-2 text-sm font-medium', className)}>
        <Spinner size="sm" />
        {t('requesting')}
      </div>
    );
  }

  if (status === 'active' || status === 'paused') {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="location-sharing"
            className={cn(
              'pointer-events-auto flex min-h-11 w-fit max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-start shadow-md hover:bg-accent focus-ring',
              className,
            )}
          >
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
              <Navigation className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">{t('sharing')}</span>
              <span className="truncate text-xs text-muted-foreground">{t('sharingHint')}</span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('bannerBody')}</p>
          <Button
            variant="outline"
            loading={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await disable();
                notify.success(t('stopped'));
              } catch (error) {
                notify.error(errorMessage(error));
              } finally {
                setStopping(false);
              }
            }}
          >
            {t('stop')}
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  // status === 'off'
  if (!consented && !dismissed) {
    return (
      <section aria-labelledby="location-banner-title" data-testid="location-banner" className={cn(CARD, 'flex flex-col gap-3', className)}>
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <LocateFixed className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="location-banner-title" className="font-semibold">
              {t('bannerTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('bannerBody')}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={dismiss}>
            {t('dismiss')}
          </Button>
          <Button leadingIcon={<LocateFixed aria-hidden="true" />} onClick={enable}>
            {t('share')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <Button
      variant="outline"
      className={cn('pointer-events-auto w-fit bg-card shadow-md', className)}
      leadingIcon={<LocateFixed aria-hidden="true" />}
      onClick={enable}
    >
      {t('share')}
    </Button>
  );
}
