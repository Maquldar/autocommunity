'use client';

import type { ServiceReviewDto } from '@autoc/shared';
import { BadgeCheck, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useServiceReviews } from './api';
import { Stars } from './stars';

function ReviewItem({ review }: { review: ServiceReviewDto }) {
  const t = useTranslations('services');
  const format = useFormatter();
  const name = review.author.nickname ? review.author.name : t('reviews.deletedUser');
  return (
    <article className="flex gap-3 py-4">
      <Avatar id={review.author.id} name={name} src={review.author.avatarUrl} size="md" decorative />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          {review.author.nickname ? (
            <Link href={`/u/${review.author.id}`} className="min-w-0 break-words font-semibold hover:underline focus-ring rounded-sm">
              {name}
            </Link>
          ) : (
            <span className="font-semibold">{name}</span>
          )}
          <time dateTime={review.createdAt} className="text-sm text-muted-foreground">
            {format.dateTime(new Date(review.createdAt), { dateStyle: 'medium' })}
          </time>
        </div>
        <Stars value={review.stars} />
        {review.comment ? <p className="whitespace-pre-line break-words text-[0.9375rem]">{review.comment}</p> : null}
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <BadgeCheck aria-hidden="true" className="size-4 text-success" />
          {t('reviews.verifiedBy', { method: t(`visit.methods.${review.visitMethod}`) })}
        </p>
      </div>
    </article>
  );
}

export function ReviewsList({ serviceId }: { serviceId: string }) {
  const t = useTranslations('services.reviews');
  const query = useServiceReviews(serviceId);
  return (
    <InfiniteList
      query={query}
      label={t('label')}
      getKey={(r) => r.id}
      renderItem={(r) => <ReviewItem review={r} />}
      skeleton={<ListItemSkeleton className="px-0" />}
      skeletonCount={3}
      listClassName="[&>li+li]:border-t"
      hideEnd
      empty={<EmptyState icon={MessageSquareText} title={t('emptyTitle')} description={t('emptyDescription')} className="py-8" />}
    />
  );
}
