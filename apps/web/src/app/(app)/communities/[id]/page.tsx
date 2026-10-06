import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CommunityView, type CommunityTab } from '@/features/communities/community-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('communities');
  return { title: t('pageMetaTitle') };
}

const TABS: readonly CommunityTab[] = ['chat', 'members', 'requests', 'events', 'feed'];

/** `?tab=requests` opens a tab directly (push and notification links use /communities/{id}/requests). */
export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab);
  return <CommunityView id={id} initialTab={initialTab} />;
}
