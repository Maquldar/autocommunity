'use client';

import { Ban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/lib/auth/auth-provider';

/** Shown after the API answers ACCOUNT_BLOCKED: the session is already gone in every tab. */
export function AccountBlockedScreen() {
  const t = useTranslations('auth.blocked');
  const { dismissBlocked } = useAuth();
  const router = useRouter();

  return (
    <div role="alert" className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={Ban}
        title={t('title')}
        description={t('description')}
        action={
          <Button
            onClick={() => {
              dismissBlocked();
              router.replace('/');
            }}
          >
            {t('home')}
          </Button>
        }
      />
    </div>
  );
}
