import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CommunitiesView } from '@/features/communities/communities-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('communities');
  return { title: t('metaTitle') };
}

export default function CommunitiesPage() {
  return <CommunitiesView />;
}
