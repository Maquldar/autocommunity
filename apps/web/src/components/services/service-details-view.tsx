'use client';

import { BadgeCheck, CircleX, Hourglass, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { hasErrorCode } from '@/lib/api/errors';
import { roundCoords, useService } from './api';
import { CategoryTile } from './category';
import { ContactsCard } from './contacts-card';
import { useServiceErrorMessage } from './errors';
import { HoursTable } from './hours-table';
import { OpenStateLine } from './open-state';
import { PhotoGallery } from './photo-gallery';
import { ReviewsList } from './reviews-list';
import { useDistanceLabel } from './service-card';
import { RatingSummary } from './stars';
import { usePosition } from './use-position';
import { VisitSection } from './visit-section';

/** Re-render every minute so "open now" and today's row stay correct while the page is open. */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function DetailsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="mt-2 h-8 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-44 w-full rounded-2xl sm:h-52" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}

export function ServiceDetailsView({ id }: { id: string }) {
  const t = useTranslations('services');
  const ts = useTranslations('states');
  const errorMessage = useServiceErrorMessage();
  const search = useSearchParams();
  const position = usePosition({ auto: true });
  const query = useService(id, roundCoords(position.coords));
  const now = useNow();
  const distance = useDistanceLabel();

  if (query.isPending) return <DetailsSkeleton label={ts('loading')} />;
  if (query.isError) {
    if (hasErrorCode(query.error, 'NOT_FOUND') || hasErrorCode(query.error, 'VALIDATION_ERROR')) {
      return (
        <EmptyState
          icon={SearchX}
          title={t('details.notFoundTitle')}
          description={t('details.notFoundDescription')}
          action={
            <Button asChild>
              <Link href="/services">{t('details.backToList')}</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }

  const s = query.data;
  const submitted = search.get('submitted') === '1';
  const code = search.get('code');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/services"
        title={s.name}
        className="pb-0"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CategoryTile category={s.category} className="size-6 rounded-md" iconClassName="size-3.5" />
              {t(`categories.${s.category}`)}
            </span>
            {s.distanceM !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{t('card.away', { distance: distance(s.distanceM) })}</span>
              </>
            ) : null}
            {s.status === 'verified' ? (
              <Badge variant="primary" size="sm">
                <BadgeCheck aria-hidden="true" />
                {t('details.statusVerified')}
              </Badge>
            ) : s.status === 'pending' ? (
              <Badge variant="warning" size="sm">
                <Hourglass aria-hidden="true" />
                {t('pending.badge')}
              </Badge>
            ) : (
              <Badge variant="danger" size="sm">
                <CircleX aria-hidden="true" />
                {t('details.statusRejected')}
              </Badge>
            )}
          </span>
        }
      />

      {s.status === 'pending' ? (
        <Card variant="flat" className="flex gap-3 border-warning/40 bg-warning-soft text-warning-soft-foreground" role="status" data-testid="pending-banner">
          <Hourglass aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-semibold">{submitted ? t('pending.submittedTitle') : t('pending.title')}</h2>
            <p className="text-[0.9375rem]">{t('pending.description')}</p>
            <Link href="/services" className="mt-1 self-start rounded-sm font-medium underline underline-offset-4 focus-ring">
              {t('pending.toList')}
            </Link>
          </div>
        </Card>
      ) : s.status === 'rejected' ? (
        <Card variant="flat" className="bg-danger-soft text-danger-soft-foreground" role="status">
          <p className="text-[0.9375rem]">{t('details.rejectedDescription')}</p>
        </Card>
      ) : null}

      <PhotoGallery photos={s.photos} name={s.name} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Card className="flex flex-col gap-3 lg:col-start-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="service-rating">
            <RatingSummary rating={s.rating} reviewCount={s.reviewCount} size="lg" />
            <span className="text-sm text-muted-foreground">{t('details.visits', { count: s.visitCount })}</span>
          </div>
          <OpenStateLine hours={s.hours} now={now} />
          {s.description ? (
            <div className="flex flex-col gap-1 border-t pt-3">
              <h2 className="text-sm font-medium text-muted-foreground">{t('details.about')}</h2>
              <p className="whitespace-pre-line break-words text-[0.9375rem]">{s.description}</p>
            </div>
          ) : null}
        </Card>

        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <ContactsCard service={s} />
          <HoursTable hours={s.hours} now={now} />
        </aside>

        {s.status === 'verified' ? (
          <div className="lg:col-start-1">
            <VisitSection service={s} now={now} initialCode={code} />
          </div>
        ) : null}

        {s.status === 'verified' ? (
          <section aria-labelledby="service-reviews" className="flex flex-col lg:col-start-1">
            <h2 id="service-reviews" className="text-xl font-semibold tracking-tight">
              {t('reviews.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {s.reviewCount > 0 ? t('reviews.summary', { count: s.reviewCount }) : t('reviews.summaryEmpty')}
            </p>
            <ReviewsList serviceId={s.id} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
