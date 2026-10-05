import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ServiceDetailsView } from '@/components/services/service-details-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('services');
  return { title: t('detailsMetaTitle') };
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ServiceDetailsView id={id} />
    </Suspense>
  );
}
