import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReportsView } from '@/features/admin/reports-view';
import { pickParam } from '@/features/admin/view-models';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.reports');
  return { title: t('title') };
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <ReportsView initialStatus={pickParam(status, ['open', 'confirmed', 'dismissed'] as const) ?? 'open'} />;
}
