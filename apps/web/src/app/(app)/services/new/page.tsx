import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SubmitServiceView } from '@/components/services/submit-service-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('services');
  return { title: t('newMetaTitle') };
}

export default function NewServicePage() {
  return <SubmitServiceView />;
}
