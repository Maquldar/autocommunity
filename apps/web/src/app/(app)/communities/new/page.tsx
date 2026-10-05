import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NewCommunityView } from '@/features/communities/new-community-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('communities.new');
  return { title: t('metaTitle') };
}

export default function NewCommunityPage() {
  return <NewCommunityView />;
}
