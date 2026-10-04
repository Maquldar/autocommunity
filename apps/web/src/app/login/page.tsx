import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PublicLayout } from '@/components/layout/public-layout';
import { LoginView } from '@/features/auth/login-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('metaTitle') };
}

export default function LoginPage() {
  return (
    <PublicLayout width="form">
      {/* useSearchParams (?next=) needs a Suspense boundary for static rendering. */}
      <Suspense>
        <LoginView />
      </Suspense>
    </PublicLayout>
  );
}
