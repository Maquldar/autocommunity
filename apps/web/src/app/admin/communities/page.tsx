import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CommunitiesAdminView } from '@/features/admin/communities-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.communities');
  return { title: t('title') };
}

export default function AdminCommunitiesPage() {
  return <CommunitiesAdminView />;
}
