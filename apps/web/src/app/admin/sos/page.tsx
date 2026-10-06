import { SOS_STATUSES } from '@autoc/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SosListView } from '@/features/admin/sos-view';
import { pickParam } from '@/features/admin/view-models';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sos');
  return { title: t('title') };
}

export default async function AdminSosPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <SosListView initialStatus={pickParam(status, SOS_STATUSES)} />;
}
