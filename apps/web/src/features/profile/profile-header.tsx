'use client';

import type { Me, UserPublic } from '@autoc/shared';
import { CalendarDays, MapPin } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { RatingBadge } from '@/components/ui/rating-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PremiumBadge, TierBadge, UserAvatar } from '@/components/ui/user-avatar';
import { hasPremium, resolveTier } from '@/lib/tier';
import { useCityName } from './city';

type Profile = Pick<UserPublic | Me, 'id' | 'name' | 'nickname' | 'avatarUrl' | 'city' | 'bio' | 'rating' | 'createdAt' | 'status'> &
  Partial<Pick<UserPublic, 'isPremium' | 'profileFrame' | 'tier'>>;

/**
 * Avatar (tier ring + premium frame), name, @nickname, premium badge and the tier chip (every tier has a
 * name, Phase 10), city, trust rating, member since and bio; `footer` goes under the bio (the "what people
 * say" traits line).
 */
export function ProfileHeader({ user, actions, footer }: { user: Profile; actions?: ReactNode; footer?: ReactNode }) {
  const t = useTranslations('profile');
  const format = useFormatter();
  const cityName = useCityName();
  const tier = resolveTier(user);
  const premium = hasPremium(user);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-start">
        <UserAvatar user={user} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:items-start">
          <h1 className="max-w-full text-2xl font-semibold leading-8 tracking-tight break-words">{user.name}</h1>
          {user.nickname ? <p className="max-w-full break-all text-[0.9375rem] text-muted-foreground">@{user.nickname}</p> : null}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground sm:justify-start">
            <span data-testid="profile-rating" data-rating={user.rating} className="inline-flex">
              <RatingBadge rating={user.rating} showLabel />
            </span>
            {premium ? <PremiumBadge /> : null}
            <TierBadge tier={tier} />
            {user.status === 'blocked' ? <Badge variant="danger">{t('blocked')}</Badge> : null}
            {user.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden="true" className="size-4" />
                {cityName(user.city)}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <CalendarDays aria-hidden="true" className="size-4" />
              {t('memberSince', { date: format.dateTime(new Date(user.createdAt), { month: 'long', year: 'numeric' }) })}
            </span>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
      {user.bio ? <p className="whitespace-pre-line break-words text-[0.9375rem] leading-6">{user.bio}</p> : null}
      {footer}
    </Card>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start sm:p-5">
      <Skeleton className="size-24 rounded-full" />
      <div className="flex w-full flex-1 flex-col items-center gap-2 sm:items-start">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-1 h-6 w-64 max-w-full" />
      </div>
    </div>
  );
}
