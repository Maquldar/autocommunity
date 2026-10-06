import { SERVICE_STATUSES } from '@autoc/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ServicesAdminView } from '@/features/admin/services-view';
import { pickParam } from '@/features/admin/view-models';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.services');
  return { title: t('title') };
}

export default async function AdminServicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <ServicesAdminView initialStatus={pickParam(status, SERVICE_STATUSES) ?? 'pending'} />;
}
