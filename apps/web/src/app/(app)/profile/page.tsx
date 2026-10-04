import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OwnProfileView } from '@/features/profile/own-profile-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('metaTitle') };
}

export default function ProfilePage() {
  return <OwnProfileView />;
}
