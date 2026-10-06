'use client';

import { Clock, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useSos } from './api';
import { PersonSummary, useDistance } from './parts';
import { SosStatusBadge, SosTypeTile } from './sos-type';
import { helperView } from './view-model';

/** Bottom sheet for a tapped SOS marker: the SOS card essentials and a way into the full page. */
export function SosMapSheet({ sosId, onClose }: { sosId: string | null; onClose: () => void }) {
  return (
    <Sheet open={sosId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="sos-sheet">{sosId ? <SheetBody id={sosId} /> : null}</SheetContent>
    </Sheet>
  );
}

function SheetBody({ id }: { id: string }) {
  const t = useTranslations('sos');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const distance = useDistance();
  const errorMessage = useErrorMessage();
  const sos = useSos(id);

  if (sos.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <SheetTitle className="sr-only">{t('map.loading')}</SheetTitle>
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }
  if (sos.isError || !sos.data) {
    return (
      <>
        <SheetTitle className="sr-only">{t('guidance.notFound.title')}</SheetTitle>
        <ErrorState title={t('guidance.notFound.title')} description={errorMessage(sos.error)} onRetry={() => void sos.refetch()} retrying={sos.isFetching} compact />
      </>
    );
  }
  const data = sos.data;
  const view = helperView(data);
  return (
    <>
      <SheetHeader className="flex-row items-center gap-3">
        <SosTypeTile type={data.type} />
        <div className="flex min-w-0 flex-col gap-1">
          <SheetTitle className="break-words">{t(`types.${data.type}`)}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SosStatusBadge status={data.status} />
              {data.distanceM !== null ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="size-4" />
                  {distance(data.distanceM)}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden="true" className="size-4" />
                {format.relativeTime(new Date(data.createdAt), now)}
              </span>
            </div>
          </SheetDescription>
        </div>
      </SheetHeader>
      <PersonSummary user={data.requester} />
      {data.description ? <p className="line-clamp-3 whitespace-pre-line break-words text-[0.9375rem]">{data.description}</p> : null}
      <SheetFooter>
        <Button asChild size="lg" fullWidth>
          <Link href={`/sos/${data.id}`}>{view.canRespond ? t('map.openToHelp') : t('map.open')}</Link>
        </Button>
      </SheetFooter>
    </>
  );
}
