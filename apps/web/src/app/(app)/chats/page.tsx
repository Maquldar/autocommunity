import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ChatsView } from '@/features/chats/chats-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chats');
  return { title: t('metaTitle') };
}

export default function ChatsPage() {
  return <ChatsView />;
}
