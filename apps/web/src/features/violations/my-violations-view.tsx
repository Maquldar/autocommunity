'use client';

import { CarFront } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { CardSkeleton } from '@/components/ui/skeleton';
import { useSubmittedViolations } from './api';
import { ViolationCard } from './violation-card';

/** /settings/violations — "Мои заявки": violations I reported, in any status. */
export function MyViolationsView() {
  const t = useTranslations('violations.mine');
  const query = useSubmittedViolations();
  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-5">
      <PageHeader title={t('title')} description={t('description')} back="/settings" />
      <InfiniteList
        query={query}
        label={t('title')}
        getKey={(v) => v.id}
        renderItem={(v) => <ViolationCard violation={v} viewerIsOwner={false} submittedList />}
        skeleton={<CardSkeleton />}
        skeletonCount={2}
        listClassName="flex flex-col gap-3"
        empty={<EmptyState icon={CarFront} title={t('emptyTitle')} description={t('emptyHint')} className="rounded-2xl border bg-card py-8" />}
      />
    </div>
  );
}
