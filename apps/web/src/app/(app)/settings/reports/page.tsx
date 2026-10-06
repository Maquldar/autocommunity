import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MyReportsView } from '@/features/reports/my-reports-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports.mine');
  return { title: t('title') };
}

export default function MyReportsPage() {
  return <MyReportsView />;
}
