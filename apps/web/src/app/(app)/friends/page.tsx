import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FriendsView } from '@/features/friends/friends-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('friends');
  return { title: t('metaTitle') };
}

export default function FriendsPage() {
  return <FriendsView />;
}
