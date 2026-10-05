'use client';

import { BellOff, CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InfiniteList } from '@/components/ui/infinite-list';
import { PageHeader } from '@/components/ui/page-header';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { notify } from '@/lib/toast';
import { NotificationItem } from './notification-item';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './queries';

export function NotificationsView() {
  const t = useTranslations('notifications');
  const online = useOnlineStatus();
  const errorMessage = useErrorMessage();
  const query = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unreadCount = unread.data?.count ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-narrow flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<CheckCheck aria-hidden="true" />}
            disabled={unreadCount === 0 || !online}
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: () => notify.success(t('allRead')),
                onError: (error) => notify.error(errorMessage(error)),
              })
            }
          >
            {t('markAllRead')}
          </Button>
        }
      />
      <InfiniteList
        query={query}
        label={t('listLabel')}
        getKey={(n) => n.id}
        className="overflow-hidden rounded-2xl border bg-card"
        listClassName="[&>li+li]:border-t"
        skeleton={<ListItemSkeleton />}
        skeletonCount={5}
        empty={<EmptyState icon={BellOff} title={t('empty.title')} description={t('empty.description')} className="border-0" />}
        renderItem={(notification) => <NotificationItem notification={notification} onRead={(n) => markRead.mutate(n)} />}
      />
    </div>
  );
}
