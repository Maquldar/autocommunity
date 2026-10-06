'use client';

import { Handshake, Pencil, Siren } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ListGroup, ListItem } from '@/components/ui/list-item';
import { useCurrentUser } from '@/lib/auth/guards';
import { RatingHistory, RatingSummary, ReviewsList } from '@/features/rating/rating-views';
import { MyVehicles } from './my-vehicles';
import { ProfileHeader } from './profile-header';

export function OwnProfileView() {
  const t = useTranslations('profile');
  const me = useCurrentUser();

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        user={me}
        actions={
          <Button asChild variant="outline" leadingIcon={<Pencil aria-hidden="true" />}>
            <Link href="/profile/edit">{t('edit')}</Link>
          </Button>
        }
      />
      {me.bio ? null : (
        <p className="-mt-4 px-1 text-sm text-muted-foreground">
          {t.rich('noBio', {
            link: (chunks) => (
              <Link href="/profile/edit" className="font-medium text-primary underline-offset-4 hover:underline focus-ring rounded-sm">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      <RatingSummary userId={me.id} self name={me.name} />
      <ListGroup>
        <ListItem
          href="/friends"
          leading={
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
              <Handshake className="size-5" />
            </span>
          }
          title={t('friendsLink')}
          description={t('friendsLinkHint')}
        />
        <ListItem
          href="/sos/history"
          leading={
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-sos-soft text-sos-soft-foreground">
              <Siren className="size-5" />
            </span>
          }
          title={t('sosHistoryLink')}
          description={t('sosHistoryHint')}
        />
      </ListGroup>
      <MyVehicles />
      <ReviewsList userId={me.id} self />
      <RatingHistory />
    </div>
  );
}
