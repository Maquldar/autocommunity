'use client';

import type { MapUser } from '@autoc/shared';
import { CarFront, CircleDashed, Clock, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RatingBadge } from '@/components/ui/rating-badge';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageButton } from '@/features/chats/message-button';
import { FriendButton } from '@/features/friends/friend-button';
import { useUser } from '@/features/profile/queries';

/** Bottom sheet (right panel on desktop) for a tapped driver: identity, trust, car, profile + friend actions. */
export function DriverCard({ driver, onClose }: { driver: MapUser | null; onClose: () => void }) {
  return (
    <Sheet open={driver !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="driver-card">{driver ? <DriverCardBody driver={driver} /> : null}</SheetContent>
    </Sheet>
  );
}

function DriverCardBody({ driver }: { driver: MapUser }) {
  const t = useTranslations('map');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  // The full profile carries `relation` for the friend button (MapUser only has friend/community/public).
  const profile = useUser(driver.userId);
  const name = profile.data?.name ?? driver.nickname;

  return (
    <>
      <SheetHeader className="flex-row items-center gap-3">
        <Avatar id={driver.userId} name={name} src={driver.avatarUrl} size="lg" decorative />
        <div className="flex min-w-0 flex-col gap-1">
          <SheetTitle className="break-words">{profile.data?.name ?? `@${driver.nickname}`}</SheetTitle>
          <SheetDescription className="break-all">@{driver.nickname}</SheetDescription>
          <div className="flex flex-wrap items-center gap-2">
            <RatingBadge rating={driver.rating} showLabel size="sm" />
            <Badge size="sm" variant={driver.relation === 'friend' ? 'primary' : driver.relation === 'community' ? 'success' : 'neutral'}>
              {t(`relation.${driver.relation}`)}
            </Badge>
          </div>
        </div>
      </SheetHeader>

      <ul className="flex flex-col gap-2 text-[0.9375rem]">
        <li className="flex items-center gap-2">
          <CarFront aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          {driver.vehicle ? (
            <span className="break-words">
              {driver.vehicle.brand} {driver.vehicle.model}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('card.noCar')}</span>
          )}
        </li>
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock aria-hidden="true" className="size-5 shrink-0" />
          {t('card.updated', { time: format.relativeTime(new Date(driver.updatedAt), now) })}
        </li>
        {driver.approximate ? (
          <li className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="approximate-note">
            <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('card.approximate')}
          </li>
        ) : null}
      </ul>

      <SheetFooter className="sm:flex-row sm:[&>*]:flex-1">
        {profile.data ? (
          <FriendButton user={{ id: profile.data.id, name: profile.data.name, relation: profile.data.relation }} size="lg" fullWidth />
        ) : profile.isPending ? (
          <Skeleton className="h-12 w-full rounded-lg" />
        ) : null}
        <MessageButton userId={driver.userId} size="lg" fullWidth />
        <Button asChild variant="outline" size="lg" fullWidth leadingIcon={<UserRound aria-hidden="true" />}>
          <Link href={`/u/${driver.userId}`}>{t('card.openProfile')}</Link>
        </Button>
      </SheetFooter>
    </>
  );
}
