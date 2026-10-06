import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SosDetailView } from '@/features/admin/sos-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sos');
  return { title: t('detailTitle') };
}

export default async function AdminSosDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SosDetailView id={id} />;
}
