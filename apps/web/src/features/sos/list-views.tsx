'use client';

import type { SosDto } from '@autoc/shared';
import { History, MapPinOff, Settings2, ShieldCheck, Siren } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { RatingBadge } from '@/components/ui/rating-badge';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { hasErrorCode } from '@/lib/api/errors';
import { useCurrentUser } from '@/lib/auth/guards';
import { useLocationSharing } from '@/lib/location/location-provider';
import { useNearbySos, useSosHistory } from './api';
import { SosEmergencyFooter, SosGuidanceNotice, useDistance } from './parts';
import { SosStatusBadge, SosTypeTile } from './sos-type';

/** One SOS as a navigable row: type tile, type + status, requester, distance and age. */
function SosRow({ sos, context }: { sos: SosDto; context: 'nearby' | 'history' }) {
  const t = useTranslations('sos');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const distance = useDistance();
  const name = sos.requester.name || `@${sos.requester.nickname}`;
  const role =
    sos.myRole === 'requester' ? t('history.asRequester') : sos.responses.some((r) => r.status === 'arrived' || r.status === 'accepted') ? t('history.asHelper') : t('history.asResponder');
  return (
    <Link
      href={`/sos/${sos.id}`}
      className="flex min-h-16 w-full items-start gap-3 px-4 py-3 text-start transition-colors duration-fast hover:bg-accent focus-ring focus-visible:-outline-offset-2"
      data-testid="sos-row"
      data-sos-id={sos.id}
    >
      <SosTypeTile type={sos.type} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">{t(`types.${sos.type}`)}</span>
          <SosStatusBadge status={sos.status} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {context === 'nearby' ? (
            <>
              <span className="break-words text-foreground">{name}</span>
              <RatingBadge rating={sos.requester.rating} size="sm" />
            </>
          ) : (
            <span>{role}</span>
          )}
          {context === 'nearby' && sos.distanceM !== null ? <span>· {distance(sos.distanceM)}</span> : null}
          <time dateTime={sos.createdAt}>· {context === 'nearby' ? format.relativeTime(new Date(sos.createdAt), now) : format.dateTime(new Date(sos.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </span>
        {context === 'nearby' && sos.description ? <span className="line-clamp-2 break-words text-sm">{sos.description}</span> : null}
      </span>
    </Link>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="overflow-hidden rounded-2xl border bg-card">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, i) => (
        <ListItemSkeleton key={i} />
      ))}
    </div>
  );
}

/** /sos/nearby — open SOS within 20 km of the stored location (helpers). */
export function NearbySosView() {
  const t = useTranslations('sos');
  const ts = useTranslations('states');
  const me = useCurrentUser();
  const errorMessage = useErrorMessage();
  const { position, status, enable } = useLocationSharing();
  const sharing = status !== 'off' && status !== 'denied' && status !== 'unavailable';
  const query = useNearbySos(position ? { lat: position.lat, lng: position.lng } : null, Boolean(position));
  const locationRequired = !position || hasErrorCode(query.error, 'LOCATION_REQUIRED');

  let body;
  if (locationRequired) {
    body = (
      <div className="flex flex-col gap-4" data-testid="sos-nearby-location">
        <EmptyState
          icon={MapPinOff}
          title={t('guidance.locationRequired.title')}
          description={status === 'denied' ? t('nearby.locationDenied') : t('guidance.locationRequired.body')}
          action={
            status === 'denied' ? undefined : (
              <Button onClick={enable} loading={sharing && !position}>
                {t('guidance.actions.shareLocation')}
              </Button>
            )
          }
        />
      </div>
    );
  } else if (query.isPending) {
    body = <ListSkeleton label={ts('loading')} />;
  } else if (query.isError && !query.data) {
    body = <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  } else if (query.data!.length === 0) {
    body = (
      <EmptyState
        icon={ShieldCheck}
        title={t('nearby.empty.title')}
        description={me.receiveSos ? t('nearby.empty.body') : t('nearby.empty.bodyAlertsOff')}
        action={
          me.receiveSos ? undefined : (
            <Button asChild variant="outline" leadingIcon={<Settings2 aria-hidden="true" />}>
              <Link href="/settings">{t('nearby.settings')}</Link>
            </Button>
          )
        }
      />
    );
  } else {
    body = (
      <ul aria-label={t('nearby.listLabel')} className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t" data-testid="sos-nearby-list">
        {query.data!.map((sos) => (
          <li key={sos.id}>
            <SosRow sos={sos} context="nearby" />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader title={t('nearby.title')} description={t('nearby.description')} back="/map" />
      {query.isError && query.data && !locationRequired ? <SosGuidanceNotice error={query.error} context="nearby" /> : null}
      {body}
      <SosEmergencyFooter />
    </div>
  );
}

/** /sos/history — my SOS as requester and as helper. */
export function SosHistoryView() {
  const t = useTranslations('sos.history');
  const query = useSosHistory();
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} back="/profile" />
      <InfiniteList
        query={query}
        label={t('listLabel')}
        getKey={(sos) => sos.id}
        renderItem={(sos) => <SosRow sos={sos} context="history" />}
        skeleton={<ListItemSkeleton />}
        skeletonCount={4}
        listClassName="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t"
        empty={
          <EmptyState
            icon={History}
            title={t('empty.title')}
            description={t('empty.body')}
            action={
              <Button asChild variant="outline" leadingIcon={<Siren aria-hidden="true" />}>
                <Link href="/sos/nearby">{t('empty.action')}</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}

