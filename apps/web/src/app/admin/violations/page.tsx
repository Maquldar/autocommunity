import { VIOLATION_STATUSES } from '@autoc/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ViolationsView } from '@/features/admin/violations-view';
import { pickParam } from '@/features/admin/view-models';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.violations');
  return { title: t('title') };
}

export default async function AdminViolationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <ViolationsView initialStatus={pickParam(status, VIOLATION_STATUSES) ?? 'pending'} />;
}
