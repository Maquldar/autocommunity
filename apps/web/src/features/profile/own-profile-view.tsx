'use client';

import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/lib/auth/guards';
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
      <MyVehicles />
    </div>
  );
}
