import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { VisitsView } from '@/features/admin/visits-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.visits');
  return { title: t('title') };
}

export default function AdminVisitsPage() {
  return <VisitsView />;
}
