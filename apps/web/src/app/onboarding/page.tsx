import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageSkeleton } from '@/components/layout/signed-in-shell';
import { PublicLayout } from '@/components/layout/public-layout';
import { OnboardingView } from '@/features/onboarding/onboarding-view';
import { RequireAuth } from '@/lib/auth/guards';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('metaTitle') };
}

export default async function OnboardingPage() {
  const t = await getTranslations('states');
  return (
    <PublicLayout>
      <RequireAuth mode="onboarding" fallback={<PageSkeleton label={t('loading')} />}>
        <OnboardingView />
      </RequireAuth>
    </PublicLayout>
  );
}
