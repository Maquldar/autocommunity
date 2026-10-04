'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CountBadge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';

/** Top-bar bell with unread count. Pass `href` once /notifications exists; until then pass `onClick`. */
export function NotificationBell({ count, href, onClick }: { count: number; href?: string; onClick?: () => void }) {
  const t = useTranslations('shell');
  const label = count > 0 ? t('notificationsUnread', { count }) : t('notifications');
  const badge = <CountBadge aria-hidden="true" count={count} className="absolute -end-0.5 -top-0.5" />;

  if (href) {
    return (
      <IconButton asChild aria-label={label}>
        <Link href={href}>
          <Bell />
          {badge}
        </Link>
      </IconButton>
    );
  }
  return (
    <IconButton aria-label={label} onClick={onClick}>
      <Bell />
      {badge}
    </IconButton>
  );
}
