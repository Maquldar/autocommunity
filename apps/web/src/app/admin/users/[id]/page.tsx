import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UserDetailView } from '@/features/admin/user-detail-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.user');
  return { title: t('title') };
}

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserDetailView id={id} />;
}
