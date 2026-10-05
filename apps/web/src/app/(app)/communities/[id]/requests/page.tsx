import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CommunityView } from '@/features/communities/community-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('communities');
  return { title: t('requestsMetaTitle') };
}

/** Push URL for `community_request`: the community page with the Requests tab open. */
export default async function CommunityRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CommunityView id={id} initialTab="requests" />;
}
