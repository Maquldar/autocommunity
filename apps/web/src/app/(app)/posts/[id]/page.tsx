import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PostThreadView } from '@/features/feed/post-thread-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('feed.thread');
  return { title: t('title') };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostThreadView id={id} />;
}
