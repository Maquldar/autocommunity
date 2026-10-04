import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EditProfileView } from '@/features/profile/edit-profile-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('editTitle') };
}

export default function EditProfilePage() {
  return <EditProfileView />;
}
