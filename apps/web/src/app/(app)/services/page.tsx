import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ServicesView } from '@/components/services/services-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('services');
  return { title: t('metaTitle') };
}

export default function ServicesPage() {
  // useSearchParams (view/category in the URL) needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <ServicesView />
    </Suspense>
  );
}
