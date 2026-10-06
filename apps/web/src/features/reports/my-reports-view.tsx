'use client';

import type { ReportDto } from '@autoc/shared';
import { Flag } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useMyReports } from './api';

const STATUS_VARIANT = { open: 'warning', confirmed: 'success', dismissed: 'neutral' } as const;

function ReportRow({ report }: { report: ReportDto }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3" data-testid="my-report" data-status={report.status} data-target-type={report.targetType}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {t(`targets.${report.targetType}`)} · {t(`reasons.${report.reason}`)}
        </span>
        <Badge size="sm" variant={STATUS_VARIANT[report.status]}>
          {t(`status.${report.status}`)}
        </Badge>
      </div>
      {report.details ? <p className="break-words text-sm">{report.details}</p> : null}
      <p className="text-sm text-muted-foreground">
        <time dateTime={report.createdAt}>{format.dateTime(new Date(report.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
      </p>
      {report.resolutionNote ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="font-medium">{t('resolution')}: </span>
          {report.resolutionNote}
        </p>
      ) : null}
    </div>
  );
}

/** /settings/reports — what I reported and what moderators decided. */
export function MyReportsView() {
  const t = useTranslations('reports');
  const query = useMyReports();
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader title={t('mine.title')} description={t('mine.description')} back="/settings" />
      <InfiniteList
        query={query}
        label={t('mine.title')}
        getKey={(r) => r.id}
        renderItem={(r) => <ReportRow report={r} />}
        skeleton={<ListItemSkeleton />}
        skeletonCount={3}
        listClassName="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t"
        empty={<EmptyState icon={Flag} title={t('mine.empty.title')} description={t('mine.empty.body')} />}
      />
    </div>
  );
}
