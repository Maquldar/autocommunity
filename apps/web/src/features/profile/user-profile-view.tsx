'use client';

import { Coins, UserX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { ListGroup } from '@/components/ui/list-item';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { hasErrorCode } from '@/lib/api/errors';
import { useCurrentUser } from '@/lib/auth/guards';
import { MessageButton } from '@/features/chats/message-button';
import { FriendButton } from '@/features/friends/friend-button';
import { HOME_ROUTE } from '@/lib/routes';
import { RatingSummary, ReviewsList } from '@/features/rating/rating-views';
import { ReportButton } from '@/features/reports/report-dialog';
import { VotePanel } from '@/features/votes/vote-panel';
import { TransferDialog } from '@/features/wallet/transfer-dialog';
import { VoteTraits } from '@/features/votes/vote-traits';
import { ProfileHeader, ProfileHeaderSkeleton } from './profile-header';
import { useUser, useUserVehicles } from './queries';
import { VehicleRow } from './vehicle-row';

/** Another driver's public profile (GET /users/:id) and their vehicles. */
export function UserProfileView({ userId }: { userId: string }) {
  const t = useTranslations('profile');
  const tv = useTranslations('vehicles');
  const me = useCurrentUser();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const isSelf = userId === me.id;
  const user = useUser(userId);
  const vehicles = useUserVehicles(userId, user.isSuccess && !isSelf);
  const [transferOpen, setTransferOpen] = useState(false);

  useEffect(() => {
    if (isSelf) router.replace('/profile');
  }, [isSelf, router]);

  if (user.isPending || isSelf) {
    return (
      <div aria-busy="true" className="flex flex-col gap-8">
        <span className="sr-only">{t('loading')}</span>
        <ProfileHeaderSkeleton />
      </div>
    );
  }
  // Invalid ids are rejected with VALIDATION_ERROR; both mean "no such driver" to the user.
  if (user.isError && (hasErrorCode(user.error, 'NOT_FOUND') || hasErrorCode(user.error, 'VALIDATION_ERROR'))) {
    return (
      <EmptyState
        icon={UserX}
        title={t('notFoundTitle')}
        description={t('notFoundDescription')}
        action={
          <Button asChild>
            <Link href={HOME_ROUTE}>{t('backToMine')}</Link>
          </Button>
        }
      />
    );
  }
  if (user.isError) {
    return <ErrorState description={errorMessage(user.error)} onRetry={() => void user.refetch()} retrying={user.isFetching} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        user={user.data}
        footer={<VoteTraits userId={user.data.id} />}
        actions={
          user.data.status === 'active' ? (
            <>
              <FriendButton user={{ id: user.data.id, name: user.data.name, relation: user.data.relation }} />
              <MessageButton userId={user.data.id} />
              <Button variant="outline" leadingIcon={<Coins aria-hidden="true" />} onClick={() => setTransferOpen(true)} data-testid="profile-transfer">
                {t('transfer')}
              </Button>
            </>
          ) : null
        }
      />
      <RatingSummary userId={user.data.id} self={false} name={user.data.name} />
      <VotePanel userId={user.data.id} name={user.data.name} />
      <section aria-labelledby="user-vehicles-heading" className="flex flex-col gap-3">
        <h2 id="user-vehicles-heading" className="text-xl font-semibold tracking-tight">
          {tv('title')}
        </h2>
        {vehicles.isPending ? (
          <div aria-busy="true" className="overflow-hidden rounded-2xl border bg-card">
            <span className="sr-only">{tv('loading')}</span>
            <ListItemSkeleton />
          </div>
        ) : vehicles.isError ? (
          <ErrorState compact onRetry={() => void vehicles.refetch()} retrying={vehicles.isFetching} className="rounded-2xl border bg-card" />
        ) : vehicles.data.length === 0 ? (
          <p className="rounded-2xl border bg-card px-4 py-6 text-center text-[0.9375rem] text-muted-foreground">
            {tv('noneForUser', { name: user.data.name })}
          </p>
        ) : (
          <ListGroup>
            {vehicles.data.map((vehicle) => (
              <VehicleRow key={vehicle.id} vehicle={vehicle} />
            ))}
          </ListGroup>
        )}
      </section>
      <ReviewsList userId={user.data.id} self={false} />
      <div className="flex justify-center">
        <ReportButton target={{ type: 'user', id: user.data.id }} label={t('report')} size="sm" />
      </div>
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        recipient={{
          id: user.data.id,
          name: user.data.name,
          nickname: user.data.nickname,
          avatarUrl: user.data.avatarUrl,
          rating: user.data.rating,
          isPremium: user.data.isPremium,
          tier: user.data.tier,
        }}
      />
    </div>
  );
}
