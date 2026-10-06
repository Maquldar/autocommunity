import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardView } from '@/features/admin/dashboard-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.dashboard');
  return { title: t('title') };
}

export default function AdminDashboardPage() {
  return <DashboardView />;
}
