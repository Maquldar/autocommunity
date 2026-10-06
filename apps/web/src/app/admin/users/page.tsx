import { ADMIN_USER_STATUSES } from '@autoc/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UsersView } from '@/features/admin/users-view';
import { pickParam } from '@/features/admin/view-models';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.users');
  return { title: t('title') };
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <UsersView initialStatus={pickParam(status, ADMIN_USER_STATUSES)} />;
}
