'use client';

import { Newspaper } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { useFeed, type FeedParams } from './api';
import { PostCard, PostCardSkeleton } from './post-card';

export function FeedList({ params, emptyDescription }: { params: FeedParams; emptyDescription?: string }) {
  const t = useTranslations('feed');
  const query = useFeed(params);
  return (
    <InfiniteList
      query={query}
      label={t('listLabel')}
      getKey={(post) => post.id}
      listClassName="flex flex-col gap-4"
      skeleton={<PostCardSkeleton />}
      skeletonCount={3}
      empty={<EmptyState className="rounded-2xl border bg-card" icon={Newspaper} title={t('empty.title')} description={emptyDescription ?? t(`empty.${params.scope}`)} />}
      renderItem={(post) => <PostCard post={post} />}
    />
  );
}
