import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UserProfileView } from '@/features/profile/user-profile-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('publicMetaTitle') };
}

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserProfileView userId={id} />;
}
