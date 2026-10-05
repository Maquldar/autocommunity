'use client';

import { UserX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { ListGroup } from '@/components/ui/list-item';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import { useErrorMessage } from '@/hooks/use-error-message';
import { hasErrorCode } from '@/lib/api/errors';
import { useCurrentUser } from '@/lib/auth/guards';
import { FriendButton } from '@/features/friends/friend-button';
import { HOME_ROUTE } from '@/lib/routes';
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
        actions={
          user.data.status === 'active' ? (
            <FriendButton user={{ id: user.data.id, name: user.data.name, relation: user.data.relation }} />
          ) : null
        }
      />
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
    </div>
  );
}
