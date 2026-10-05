'use client';

import { Clock, LinkIcon, MapPin, RefreshCw, UserRound } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { hasErrorCode } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { usePublicSos } from './api';
import { osmUrl } from './format';
import { SosEmergencyFooter, SosTimeline } from './parts';
import { SosMap } from './sos-map';
import { SosStatusBadge, SosTypeTile } from './sos-type';
import { isSosOpen, timelineSteps } from './view-model';

/**
 * /s/[token] — what a trusted contact sees without an account: type, status, location, the requester's
 * first name, helper nicknames and the last update. Refreshes every 30 s; 404 → "link expired".
 */
export function PublicSosView({ token }: { token: string }) {
  const t = useTranslations('sos');
  const format = useFormatter();
  const now = useNow({ updateInterval: 15_000 });
  const errorMessage = useErrorMessage();
  const query = usePublicSos(token);

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t('public.loading')}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  if (query.isError && !query.data) {
    const gone = hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR');
    return (
      <div className="flex flex-col gap-6" data-testid="public-sos" data-state={gone ? 'not-found' : 'error'}>
        {gone ? (
          <EmptyState icon={LinkIcon} title={t('public.notFound.title')} description={t('public.notFound.body')} />
        ) : (
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        )}
        <SosEmergencyFooter variant="full" />
      </div>
    );
  }

  const sos = query.data!;
  const open = isSosOpen(sos.status);
  const helpers = sos.helperNicknames.length > 0 ? sos.helperNicknames : sos.helperNickname ? [sos.helperNickname] : [];
  // The public DTO has no responses; infer the reached steps from the status and the helpers.
  const steps = timelineSteps({
    status: sos.status,
    responses: helpers.map((_, i) => ({ status: sos.status === 'in_progress' || sos.status === 'closed' ? 'arrived' : 'accepted', id: String(i) })) as never,
  });

  return (
    <div className="flex flex-col gap-5" data-testid="public-sos" data-state="ok" data-status={sos.status}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t('public.title', { name: sos.requesterName })}</h1>
        <p className="text-[0.9375rem] text-muted-foreground">{t('public.subtitle')}</p>
      </header>

      <Card className={cn('flex flex-col gap-4 p-4 sm:p-5', open && 'border-sos/40')}>
        <div className="flex items-start gap-3">
          <SosTypeTile type={sos.type} size="lg" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-xl font-semibold tracking-tight">{t(`types.${sos.type}`)}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <SosStatusBadge status={sos.status} />
              <span className="inline-flex items-center gap-1" data-testid="public-updated">
                <Clock aria-hidden="true" className="size-4" />
                {t('public.updated', { time: format.relativeTime(new Date(sos.updatedAt), now) })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{t('public.helpers')}</span>
          {helpers.length > 0 ? (
            <ul className="flex flex-wrap gap-2" data-testid="public-helpers">
              {helpers.map((nick) => (
                <li key={nick} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm">
                  <UserRound aria-hidden="true" className="size-4" />@{nick}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.9375rem]">{open ? t('public.noHelpers') : t('public.noHelpersEnded')}</p>
          )}
        </div>
        <SosTimeline steps={steps} />
      </Card>

      <section className="flex flex-col gap-2" aria-label={t('card.location')}>
        <SosMap value={{ lat: sos.lat, lng: sos.lng }} label={t('card.mapLabel')} className="h-56 sm:h-64" zoom={15} />
        <a
          href={osmUrl(sos.lat, sos.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm"
        >
          <MapPin aria-hidden="true" className="size-4" />
          {t('card.openInMaps')}
        </a>
      </section>

      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
        <RefreshCw aria-hidden="true" className={cn('size-4', query.isFetching && 'motion-safe:animate-spin')} />
        {t('public.refresh')}
      </p>

      <SosEmergencyFooter variant="full" />
    </div>
  );
}
