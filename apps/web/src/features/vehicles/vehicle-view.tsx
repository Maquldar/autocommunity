'use client';

import type { VehicleDetailDto } from '@autoc/shared';
import { CarFront, Flag, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PhotoGallery } from '@/components/services/photo-gallery';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { RatingBadge } from '@/components/ui/rating-badge';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserAvatar, UserName } from '@/components/ui/user-avatar';
import { hasErrorCode } from '@/lib/api/errors';
import { useCurrentUser } from '@/lib/auth/guards';
import { useVehicleViolations } from '@/features/violations/api';
import { ReportViolationDialog } from '@/features/violations/report-violation-dialog';
import { ViolationCard } from '@/features/violations/violation-card';
import { useVehicle } from './api';
import { vehicleFacts } from './facts';

export type VehicleTab = 'details' | 'violations';

/** /vehicles/[id] — photos, details, the owner, and tabs details | violations (?tab=violations). */
export function VehicleView({ vehicleId, initialTab = 'details' }: { vehicleId: string; initialTab?: VehicleTab }) {
  const t = useTranslations('vehicles.page');
  const query = useVehicle(vehicleId);

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <CardSkeleton />
      </div>
    );
  }
  if (query.isError) {
    return hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR') ? (
      <EmptyState
        icon={CarFront}
        title={t('notFound')}
        description={t('notFoundHint')}
        action={
          <Button asChild>
            <Link href="/profile">{t('backToProfile')}</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} className="rounded-2xl border bg-card" />
    );
  }
  return <Vehicle vehicle={query.data} initialTab={initialTab} />;
}

function Vehicle({ vehicle, initialTab }: { vehicle: VehicleDetailDto; initialTab: VehicleTab }) {
  const t = useTranslations('vehicles.page');
  const me = useCurrentUser();
  const [tab, setTab] = useState<VehicleTab>(initialTab);
  const tabParam = useSearchParams().get('tab');
  useEffect(() => {
    setTab(tabParam === 'violations' ? 'violations' : 'details');
  }, [tabParam]);
  const [reporting, setReporting] = useState(false);
  const isOwner = vehicle.owner.id === me.id;
  const name = `${vehicle.brand} ${vehicle.model}`;

  const changeTab = (value: string) => {
    const next = value === 'violations' ? 'violations' : 'details';
    setTab(next);
    // Keep ?tab in the URL so push links and reloads land on the same tab.
    const url = new URL(window.location.href);
    if (next === 'details') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back title={name} description={t('subtitle', { year: vehicle.year })} />
      <PhotoGallery photos={vehicle.photos} name={name} />

      <Link href={isOwner ? '/profile' : `/u/${vehicle.owner.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-accent focus-ring" data-testid="vehicle-owner">
        <UserAvatar user={vehicle.owner} size="md" decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-muted-foreground">{t('owner')}</span>
          <UserName user={vehicle.owner} className="font-medium" showTier />
        </span>
        <RatingBadge rating={vehicle.owner.rating} size="sm" />
      </Link>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label={t('tabsLabel')}>
          <TabsTrigger value="details">{t('tabs.details')}</TabsTrigger>
          <TabsTrigger value="violations" data-testid="vehicle-violations-tab">
            {t('tabs.violations')}
            {vehicle.approvedViolations > 0 ? <span className="ms-1.5 tabular-nums">({vehicle.approvedViolations})</span> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-4">
          <Details vehicle={vehicle} />
        </TabsContent>
        <TabsContent value="violations" className="mt-4 flex flex-col gap-4">
          {isOwner ? (
            <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">{t('ownerViolationsHint')}</p>
          ) : (
            <Button variant="outline" leadingIcon={<Flag aria-hidden="true" />} onClick={() => setReporting(true)} className="self-start" data-testid="report-violation">
              {t('report')}
            </Button>
          )}
          <ViolationsList vehicleId={vehicle.id} isOwner={isOwner} enabled={tab === 'violations'} />
        </TabsContent>
      </Tabs>
      <ReportViolationDialog vehicle={{ id: vehicle.id, brand: vehicle.brand, model: vehicle.model, ownerId: vehicle.owner.id }} open={reporting} onOpenChange={setReporting} />
    </div>
  );
}

function Details({ vehicle }: { vehicle: VehicleDetailDto }) {
  const t = useTranslations('vehicles');
  const format = useFormatter();
  const facts = vehicleFacts(vehicle);
  return (
    <div className="flex flex-col gap-4">
      {facts.length ? (
        <Card>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="vehicle-facts">
            {facts.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-sm text-muted-foreground">{t(`page.facts.${f.key}`)}</dt>
                <dd className="break-words text-[0.9375rem] font-medium" data-fact={f.key}>
                  {f.kind === 'enum'
                    ? t(`enums.${f.key}.${f.value}` as 'enums.fuel.petrol')
                    : f.kind === 'engine'
                      ? t('page.engineValue', { value: format.number(f.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
                      : f.kind === 'mileage'
                        ? t('page.mileageValue', { value: f.value })
                        : f.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : (
        <p className="rounded-2xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{t('page.noDetails')}</p>
      )}
      {vehicle.description ? (
        <section aria-labelledby="vehicle-description-heading" className="flex flex-col gap-2">
          <h2 id="vehicle-description-heading" className="text-lg font-semibold">
            {t('fields.description')}
          </h2>
          <p className="whitespace-pre-line break-words text-[0.9375rem]">{vehicle.description}</p>
        </section>
      ) : null}
    </div>
  );
}

function ViolationsList({ vehicleId, isOwner, enabled }: { vehicleId: string; isOwner: boolean; enabled: boolean }) {
  const t = useTranslations('violations');
  const query = useVehicleViolations(vehicleId, enabled);
  return (
    <InfiniteList
      query={query}
      label={t('listLabel')}
      getKey={(v) => v.id}
      renderItem={(v) => <ViolationCard violation={v} viewerIsOwner={isOwner} />}
      skeleton={<CardSkeleton />}
      skeletonCount={2}
      listClassName="flex flex-col gap-3"
      hideEnd
      empty={<EmptyState icon={ShieldAlert} title={t('emptyTitle')} description={isOwner ? t('emptyOwner') : t('emptyHint')} className="rounded-2xl border bg-card py-8" />}
    />
  );
}
